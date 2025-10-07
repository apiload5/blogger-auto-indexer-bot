const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');
const { URL } = require('url');

// =================================================================
// ## PLATFORM DETECTION & SSL CONFIG
// =================================================================

const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const IS_REPLIT = process.env.REPLIT_DB_URL !== undefined;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

console.log('🏁 Platform Detection:');
console.log(`📍 GitHub Actions: ${IS_GITHUB_ACTIONS}`);
console.log(`📍 Replit: ${IS_REPLIT}`);
console.log(`📍 Production: ${IS_PRODUCTION}`);

// SSL Configuration based on platform
let sslConfig = {};
if (IS_REPLIT) {
  // Replit-specific SSL fix
  require('https').globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
} else if (IS_GITHUB_ACTIONS) {
  // GitHub Actions - usually fewer SSL issues
  console.log('🔧 GitHub Actions environment detected');
}

// Environment variables
const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  BLOG_URL,
  RSS_FEED_URL,
  ENABLE_SCHEDULER = 'true', // Default true for Replit, false for GitHub
  MAX_URLS_PER_RUN = '25',
  RUN_IMMEDIATELY = 'true'
} = process.env;

// Constants with environment overrides
const MAX_URLS_TO_SUBMIT = parseInt(MAX_URLS_PER_RUN) || 25;
const DELAY_BETWEEN_REQUESTS = 2000;
const ENABLE_CRON = ENABLE_SCHEDULER === 'true';
const SHOULD_RUN_NOW = RUN_IMMEDIATELY === 'true';

// =================================================================
// ## INITIALIZE SERVICES WITH PLATFORM CONFIG
// =================================================================

// RSS Parser with platform-specific timeout
const parser = new Parser({
  timeout: IS_GITHUB_ACTIONS ? 15000 : 10000,
  customFields: {
    item: ['pubDate', 'link', 'title', 'content', 'guid']
  }
});

// Google Indexing API Auth
const indexingAuth = new google.auth.JWT(
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY ? GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  ['https://www.googleapis.com/auth/indexing'],
  null
);

const indexing = google.indexing('v3');

// Axios instance with platform-specific config
const axiosInstance = axios.create({
  timeout: IS_GITHUB_ACTIONS ? 20000 : 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
});

// =================================================================
// ## POST FETCHING FUNCTIONS
// =================================================================

async function getPostsFromHTML() {
  try {
    console.log('🌐 Checking blog via HTML...');
    const response = await axiosInstance.get(BLOG_URL);
    const html = response.data;
    
    const postUrlPatterns = [
      /href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g,
      /href="([^"]*\/p\/[^"]*\.html)"/g,
      /<a[^>]*href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*)"[^>]*>/g,
      /href="(https:\/\/[^"]*\.blogspot\.com\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g
    ];
    
    const posts = [];
    const seenUrls = new Set();
    const blogBase = new URL(BLOG_URL).origin;

    for (const pattern of postUrlPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1];
        if (url.startsWith('/')) { 
          url = blogBase + url; 
        }
        if (!seenUrls.has(url) && url.includes('http') && url.includes('.html') && !url.includes('search?q=')) {
          seenUrls.add(url);
          posts.push({ 
            url: url, 
            title: `Post from ${new URL(url).pathname}`,
            source: 'html'
          });
        }
      }
    }
    console.log(`✅ Found ${posts.length} posts via HTML`);
    return posts; 
  } catch (error) {
    console.error('❌ HTML scraping error:', error.message);
    return [];
  }
}

async function getLatestPosts() {
  try {
    console.log('📝 Checking for new posts...');
    let rssUrl = RSS_FEED_URL || `${BLOG_URL.replace(/\/$/, '')}/feeds/posts/default?alt=rss`;
    console.log(`📡 Using RSS feed: ${rssUrl}`);
    
    const feed = await parser.parseURL(rssUrl);
    const posts = (feed.items || []).map(item => ({
      ...item,
      source: 'rss'
    }));
    
    console.log(`✅ Found ${posts.length} posts via RSS`);
    return posts;
  } catch (error) {
    console.error('❌ RSS Error:', error.message);
    console.log('🔄 Falling back to HTML scraping...');
    return await getPostsFromHTML();
  }
}

// =================================================================
// ## INDEXING FUNCTIONS
// =================================================================

async function indexUrl(url) {
  try {
    console.log(`🔍 Submitting URL: ${url}`);
    
    const response = await indexing.urlNotifications.publish({
      auth: indexingAuth,
      requestBody: { 
        url: url, 
        type: 'URL_UPDATED' 
      }
    });

    console.log(`✅ Successfully submitted: ${url}`);
    return { success: true, url: url, response: response.data };
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    
    if (errorMessage.includes('Quota exceeded')) {
      console.error('🚨 QUOTA EXCEEDED. Stopping job.');
      throw new Error('Quota Exceeded'); 
    }
    
    if (errorMessage.includes('already')) {
      console.log(`ℹ️ URL already submitted: ${url}`);
      return { success: true, url: url, note: 'Already submitted' };
    }
    
    console.error(`❌ Error submitting URL: ${url}`, errorMessage);
    return { success: false, url: url, error: errorMessage };
  }
}

// =================================================================
// ## MAIN INDEXING LOGIC
// =================================================================

async function checkAndIndexNewPosts() {
  let results = [];
  try {
    console.log('\n🚀 Starting Google Indexing Check...');
    console.log(`📍 Platform: ${IS_REPLIT ? 'Replit' : IS_GITHUB_ACTIONS ? 'GitHub Actions' : 'Unknown'}`);
    
    const latestPosts = await getLatestPosts();
    
    if (latestPosts.length === 0) {
      console.log('❌ No posts found to submit');
      return { success: false, message: 'No posts found' };
    }

    const postsToSubmit = latestPosts.slice(0, MAX_URLS_TO_SUBMIT);
    console.log(`📦 Processing ${postsToSubmit.length} posts (Limit: ${MAX_URLS_TO_SUBMIT})`);

    for (const [index, post] of postsToSubmit.entries()) {
      const postUrl = post.url || post.link;
      if (!postUrl) continue;
      
      try {
        console.log(`📄 [${index + 1}/${postsToSubmit.length}] Processing: ${postUrl}`);
        const result = await indexUrl(postUrl);
        results.push(result);

        // Rate limiting - only delay if not last item
        if (index < postsToSubmit.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
        }
      } catch (error) {
        if (error.message.includes('Quota Exceeded')) {
          results.push({ success: false, url: postUrl, error: 'Quota Exceeded' });
          break; 
        }
        results.push({ success: false, url: postUrl, error: error.message });
      }
    }
    
    // Generate summary
    const submitted = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalFound = latestPosts.length;
    
    console.log(`\n==============================================`);
    console.log(`📊 INDEXING SUMMARY - ${new Date().toLocaleString()}`);
    console.log(`==============================================`);
    console.log(`📍 Platform: ${IS_REPLIT ? 'Replit' : 'GitHub Actions'}`);
    console.log(`📄 Total posts found: ${totalFound}`);
    console.log(`🔄 Posts processed: ${postsToSubmit.length}`);
    console.log(`✅ Successfully submitted: ${submitted}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏰ Next run: ${ENABLE_CRON ? 'Scheduled' : 'Manual'}`);
    console.log(`==============================================`);
    
    return {
      success: submitted > 0,
      submitted,
      failed,
      totalFound,
      platform: IS_REPLIT ? 'replit' : 'github'
    };
  } catch (error) {
    console.error('❌ Critical Indexing Process Error:', error.message);
    return { success: false, error: error.message };
  }
}

// =================================================================
// ## APPLICATION STARTUP - PLATFORM SPECIFIC
// =================================================================

async function initializeApp() {
  console.log('🚀 Blogger Auto Indexer Starting...');
  console.log('🌍 Universal Version - Works on GitHub Actions & Replit');
  
  // Validate environment
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !BLOG_URL) {
    console.error('❌ Missing required environment variables');
    console.log('💡 Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, BLOG_URL');
    return;
  }

  // Platform-specific scheduling
  if (IS_GITHUB_ACTIONS) {
    console.log('🔧 GitHub Actions Mode - Single Run');
    // GitHub Actions usually runs once, but we can add scheduling if needed
    const result = await checkAndIndexNewPosts();
    process.exit(result.success ? 0 : 1);
  } 
  else if (IS_REPLIT) {
    console.log('🔧 Replit Mode - Scheduled + Immediate Run');
    
    // Schedule for Replit (Always On feature)
    if (ENABLE_CRON) {
      const CHECK_INTERVAL = '0 */3 * * *'; // Every 3 hours
      console.log(`⏰ Scheduled mode: Running every 3 hours`);
      
      cron.schedule(CHECK_INTERVAL, async () => {
        console.log(`\n\n🕒 SCHEDULED RUN: ${new Date().toLocaleString()}`);
        await checkAndIndexNewPosts();
      });
    } else {
      console.log('⏰ Scheduler disabled via ENABLE_SCHEDULER=false');
    }
    
    // Immediate run if enabled
    if (SHOULD_RUN_NOW) {
      await checkAndIndexNewPosts();
    }
  } 
  else {
    console.log('🔧 Local/Unknown Environment - Single Run');
    await checkAndIndexNewPosts();
  }
}

// Start the application
initializeApp().catch(console.error);
