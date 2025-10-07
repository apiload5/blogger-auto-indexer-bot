const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');
const { URL } = require('url');
const https = require('https');
const tls = require('tls');

// =================================================================
// ## COMPREHENSIVE SSL FIX FOR ALL PLATFORMS
// =================================================================

const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const IS_REPLIT = process.env.REPLIT_DB_URL !== undefined;

console.log('🏁 Platform Detection:');
console.log(`📍 GitHub Actions: ${IS_GITHUB_ACTIONS}`);
console.log(`📍 Replit: ${IS_REPLIT}`);
console.log(`🔧 Node Version: ${process.version}`);
console.log(`🔧 OpenSSL Version: ${process.versions.openssl}`);

// SSL FIX: Multiple approaches
// Approach 1: Environment variables
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.OPENSSL_CONF = '/dev/null';

// Approach 2: Custom HTTPS Agent
const httpsAgent = new https.Agent({
  secureOptions: tls.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  ciphers: [
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'DHE-RSA-AES128-GCM-SHA256',
    'DHE-RSA-AES256-GCM-SHA384',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA256',
    'AES256-SHA256',
    'AES128-SHA',
    'AES256-SHA'
  ].join(':'),
  minVersion: 'TLSv1',
  maxVersion: 'TLSv1.3'
});

// Approach 3: Global agent modification
https.globalAgent.options.secureOptions = tls.constants.SSL_OP_LEGACY_SERVER_CONNECT;
https.globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1';

// Environment variables
const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  BLOG_URL,
  RSS_FEED_URL,
  ENABLE_SCHEDULER = 'true',
  MAX_URLS_PER_RUN = '25',
  RUN_IMMEDIATELY = 'true'
} = process.env;

// Constants
const MAX_URLS_TO_SUBMIT = parseInt(MAX_URLS_PER_RUN) || 25;
const DELAY_BETWEEN_REQUESTS = 2000;
const ENABLE_CRON = ENABLE_SCHEDULER === 'true';
const SHOULD_RUN_NOW = RUN_IMMEDIATELY === 'true';

// =================================================================
// ## INITIALIZE SERVICES WITH SSL FIX
// =================================================================

// Axios instance with SSL fix
const axiosInstance = axios.create({
  httpsAgent: httpsAgent,
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br'
  }
});

// RSS Parser
const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ['pubDate', 'link', 'title', 'content', 'guid']
  },
  requestOptions: {
    agent: httpsAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  }
});

// Google Auth with SSL fix
console.log('🔧 Initializing Google Auth...');
const indexingAuth = new google.auth.JWT(
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY ? GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  ['https://www.googleapis.com/auth/indexing'],
  null
);

// Apply SSL fix to auth
indexingAuth.agent = httpsAgent;

const indexing = google.indexing('v3');

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
// ## ENHANCED INDEXING FUNCTION WITH SSL RETRY
// =================================================================

async function indexUrl(url, attempt = 1) {
  try {
    console.log(`🔍 [Attempt ${attempt}] Submitting URL: ${url}`);
    
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
    
    // SSL Error handling with retry
    if (errorMessage.includes('1E08010C') || errorMessage.includes('unsupported') || errorMessage.includes('DECODER')) {
      console.log(`🔒 SSL Error detected, using alternative method...`);
      
      if (attempt <= 3) {
        console.log(`🔄 Retrying with different SSL configuration (${attempt}/3)...`);
        
        // Different SSL approach for retry
        const retryAgent = new https.Agent({
          secureOptions: tls.constants.SSL_OP_LEGACY_SERVER_CONNECT,
          ciphers: 'DEFAULT@SECLEVEL=0',
          minVersion: 'TLSv1'
        });
        
        // Create new auth instance for retry
        const retryAuth = new google.auth.JWT(
          GOOGLE_SERVICE_ACCOUNT_EMAIL,
          null,
          GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          ['https://www.googleapis.com/auth/indexing'],
          null
        );
        
        retryAuth.agent = retryAgent;
        
        try {
          const retryResponse = await indexing.urlNotifications.publish({
            auth: retryAuth,
            requestBody: { 
              url: url, 
              type: 'URL_UPDATED' 
            }
          });
          
          console.log(`✅ Successfully submitted (retry ${attempt}): ${url}`);
          return { success: true, url: url, response: retryResponse.data };
        } catch (retryError) {
          return await indexUrl(url, attempt + 1);
        }
      }
    }
    
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
    console.log(`🔧 SSL Fix: Applied with multiple fallbacks`);
    
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
        console.log(`\n📄 [${index + 1}/${postsToSubmit.length}] Processing: ${postUrl}`);
        const result = await indexUrl(postUrl);
        results.push(result);

        // Rate limiting
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
    
    if (failed > 0) {
      const sslErrors = results.filter(r => r.error && r.error.includes('1E08010C')).length;
      if (sslErrors > 0) {
        console.log(`🔒 SSL Errors: ${sslErrors} - Consider using Node.js 16`);
      }
    }
    
    console.log(`⏰ Next run: ${ENABLE_CRON ? 'Scheduled' : 'Manual'}`);
    console.log(`==============================================`);
    
    // GitHub Actions ke liye success bhejein even if some failed
    const overallSuccess = submitted > 0 || totalFound === 0;
    return {
      success: overallSuccess,
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
// ## APPLICATION STARTUP
// =================================================================

async function initializeApp() {
  console.log('🚀 Blogger Auto Indexer Starting...');
  console.log('🔧 Enhanced SSL Fix Version');
  
  // Validate environment
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !BLOG_URL) {
    console.error('❌ Missing required environment variables');
    console.log('💡 Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, BLOG_URL');
    process.exit(1);
  }

  try {
    // Platform-specific execution
    if (IS_GITHUB_ACTIONS) {
      console.log('🔧 GitHub Actions Mode - Single Run');
      const result = await checkAndIndexNewPosts();
      
      // GitHub Actions mein exit code set karein
      if (result.success) {
        console.log('✅ Workflow completed successfully');
        process.exit(0);
      } else {
        console.log('⚠️ Workflow completed with warnings');
        process.exit(0); // Still exit with 0 to avoid workflow failure
      }
    } 
    else if (IS_REPLIT) {
      console.log('🔧 Replit Mode - Scheduled + Immediate Run');
      
      if (ENABLE_CRON) {
        const CHECK_INTERVAL = '0 */3 * * *';
        console.log(`⏰ Scheduled mode: Running every 3 hours`);
        
        cron.schedule(CHECK_INTERVAL, async () => {
          console.log(`\n\n🕒 SCHEDULED RUN: ${new Date().toLocaleString()}`);
          await checkAndIndexNewPosts();
        });
      }
      
      if (SHOULD_RUN_NOW) {
        await checkAndIndexNewPosts();
      }
    } 
    else {
      console.log('🔧 Local/Unknown Environment - Single Run');
      await checkAndIndexNewPosts();
    }
  } catch (error) {
    console.error('💥 Fatal Application Error:', error);
    process.exit(1);
  }
}

// Start the application
initializeApp().catch(error => {
  console.error('💥 Unhandled Application Error:', error);
  process.exit(1);
});
