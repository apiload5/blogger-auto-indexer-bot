const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');

// 🔑 FIX: OpenSSL 3.0 error ko hal karne ke liye - HTTPS connection fix.
require('https').globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1'; 

// Environment variables - From GitHub Secrets
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, // REQUIRED
    RSS_FEED_URL, // OPTIONAL
    CHECK_INTERVAL = '0 */6 * * *', // Default 3 hours
    
    // 🔑 NEW: Search Console se nikaale gaye URLs (Commas/Newlines se separated)
    PRIORITY_INDEX_URLS 
} = process.env;

// RSS Parser initialize
const parser = new Parser();

// Google Indexing API setup
const indexing = google.indexing('v3');

// JWT Client for Indexing API
const indexingAuth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/indexing'],
    null
);

// Track already indexed URLs during the current session
let indexedUrls = new Set();

/**
 * Utility function to wait (Rate Limiting).
 */
async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Google Indexing API ke zariye URL ko index karta hai.
 */
async function indexUrl(url) {
    try {
        if (!url || !url.startsWith('http')) return { success: false, url: url, error: 'Invalid URL' };
        
        // Agar already indexed hai to skip karo
        if (indexedUrls.has(url)) {
            // console.log(`⏭️ Already processed: ${url}`);
            return { success: true, skipped: true, url: url };
        }

        console.log(`🔍 Sending request for: ${url}`);
        
        const response = await indexing.urlNotifications.publish({
            auth: indexingAuth,
            requestBody: {
                url: url,
                type: 'URL_UPDATED' // Ya 'URL_DELETED' agar aap delete kar rahe hon
            }
        });

        console.log(`✅ Success (Type: ${response.data.urlNotificationMetadata.type}): ${url}`);
        
        // Track kar lo processed URLs
        indexedUrls.add(url);
        
        return { 
            success: true, 
            url: url, 
            response: response.data 
        };
    } catch (error) {
        // Google Indexing API error yahan catch hoga
        const errorMessage = error.response?.data?.error?.message || error.message;
        console.error(`❌ Error indexing URL: ${url}`, errorMessage);
        return { 
            success: false, 
            url: url, 
            error: errorMessage 
        };
    }
}

/**
 * 🔑 NEW: Priority Indexing (Search Console se nikaale gaye URLs)
 * Sab se pehle un URLs ko index karta hai jo index nahi hue.
 */
async function priorityIndex() {
    if (!PRIORITY_INDEX_URLS) {
        return { count: 0, results: [] };
    }
    
    console.log('\n🌟 Starting Priority Indexing for unindexed URLs...');
    
    // URLs ko comma ya newline se alag karen aur saaf karen
    const urlsToForceIndex = PRIORITY_INDEX_URLS
        .split(/[,\n]/)
        .map(url => url.trim())
        .filter(url => url.length > 0 && url.startsWith('http')); // Ensure only valid http URLs
        
    let results = [];
    
    for (const url of urlsToForceIndex) {
        const result = await indexUrl(url); 
        results.push(result);
        await wait(2000); // 2 second wait (Rate limiting)
    }
    
    const successfulCount = results.filter(r => r.success && !r.skipped).length;
    console.log(`✅ Priority Indexing done. Indexed ${successfulCount} URLs.`);
    return { count: successfulCount, results: results };
}


/**
 * RSS feed se latest posts nikalta hai.
 */
async function getLatestPosts() {
    try {
        console.log('\n📝 Checking for new posts via RSS...');
        
        let rssUrl;
        
        if (RSS_FEED_URL) {
            rssUrl = RSS_FEED_URL;
        } else {
            // Automatically generate RSS URL
            rssUrl = `${BLOG_URL.replace(/\/$/, '')}/feeds/posts/default?alt=rss`;
        }
        console.log(`📡 Using RSS feed: ${rssUrl}`);
        
        const feed = await parser.parseURL(rssUrl);
        const posts = feed.items || [];
        
        console.log(`✅ Found ${posts.length} posts via RSS`);
        return posts;
        
    } catch (error) {
        console.error('❌ RSS Error:', error.message);
        console.log('🔄 Falling back to HTML scraping...');
        return await getPostsFromHTML();
    }
}

/**
 * HTML scraping fallback (Agar RSS kaam na kare).
 */
async function getPostsFromHTML() {
    try {
        console.log('🌐 Checking blog via HTML...');
        
        const response = await axios.get(BLOG_URL, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;
        
        const postUrlPatterns = [
            /href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g,
            /href="([^"]*\/p\/[^"]*\.html)"/g,
        ];

        const posts = [];
        const seenUrls = new Set();
        const blogBase = new URL(BLOG_URL).origin;

        for (const pattern of postUrlPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let url = match[1];
                
                // Relative URL ko absolute mein convert karo
                if (url.startsWith('/')) {
                    url = blogBase + url;
                }
                
                // Duplicate check karo aur valid URL filter karo
                if (!seenUrls.has(url) && 
                    url.includes('.html') &&
                    !url.includes('search?q=')) {
                    seenUrls.add(url);
                    posts.push({ url: url });
                }
            }
        }

        console.log(`✅ Found ${posts.length} posts via HTML`);
        return posts.slice(0, 15); // Last 15 posts
    } catch (error) {
        console.error('❌ HTML scraping error:', error.message);
        return [];
    }
}

/**
 * Main function to check and index posts.
 */
async function checkAndIndexNewPosts() {
    try {
        console.log('\n=============================================');
        console.log('🚀 Starting Blogger Auto Indexer Run');
        console.log(`⏰ Time: ${new Date().toISOString()}`);
        console.log(`🔗 Blog URL: ${BLOG_URL}`);
        console.log('=============================================');
        
        let totalIndexed = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        // 1. Sab se pehle Priority Indexing chalao
        const priorityResults = await priorityIndex();
        totalIndexed += priorityResults.count;
        totalSkipped += priorityResults.results.filter(r => r.skipped).length;
        totalFailed += priorityResults.results.filter(r => !r.success).length;


        // 2. Latest posts get karo
        const latestPosts = await getLatestPosts();
        
        if (latestPosts.length === 0) {
            console.log('❌ No new posts found to index.');
        }

        const latestPostResults = [];
        
        // Har post ko index karo
        for (const post of latestPosts) {
            const postUrl = post.url || post.link;
            
            if (!postUrl) continue;
            
            const result = await indexUrl(postUrl);
            latestPostResults.push(result);
            
            await wait(2000); // 2 second wait between requests
        }

        // 3. Results summary
        const newlyIndexed = latestPostResults.filter(r => r.success && !r.skipped).length;
        const latestSkipped = latestPostResults.filter(r => r.skipped).length;
        const latestFailed = latestPostResults.filter(r => !r.success).length;

        totalIndexed += newlyIndexed;
        totalSkipped += latestSkipped;
        totalFailed += latestFailed;
        
        console.log(`\n📊 FINAL Indexing Summary:`);
        console.log(`✅ Newly Indexed (Total): ${totalIndexed}`);
        console.log(`⏭️ Already Indexed (Skipped): ${totalSkipped}`);
        console.log(`❌ Failed: ${totalFailed}`);
        console.log(`📝 Total URLs Checked: ${latestPostResults.length + priorityResults.results.length}`);
        console.log('=============================================\n');
        
    } catch (error) {
        console.error('❌ Indexing process FAILED:', error);
        throw error;
    }
}

// Cron job schedule
cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n🕒 Scheduled check started at: ${new Date().toISOString()}`);
    await checkAndIndexNewPosts();
});

// Startup message and first run
const intervalParts = CHECK_INTERVAL.split(' ');
const hours = intervalParts.length > 1 && intervalParts[1].startsWith('*/') ? intervalParts[1].replace('*/', '') : '3';
console.log('🚀 Blogger Auto Indexer Started!');
console.log(`⏰ Will check every ${hours} hours for new posts`);

// First run on startup
setTimeout(() => {
    checkAndIndexNewPosts();
}, 5000);
