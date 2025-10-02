const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');

// Environment variables - GitHub Secrets se aayenge
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, // Aapke blog ka URL
    RSS_FEED_URL, // Aapke blog ka RSS feed URL
    CHECK_INTERVAL = '0 */3 * * *' // Har 3 ghante
} = process.env;

// RSS Parser initialize karein
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

// Track already indexed URLs
let indexedUrls = new Set();

// Function to get latest posts from RSS Feed
async function getLatestPosts() {
    try {
        console.log('📝 Checking for new posts via RSS...');
        
        let feed;
        
        // Agar RSS_FEED_URL hai to use karein, nahi to BLOG_URL se RSS feed banayein
        if (RSS_FEED_URL) {
            feed = await parser.parseURL(RSS_FEED_URL);
        } else {
            // Default RSS feed URL banayein
            const defaultRssUrl = `${BLOG_URL.replace(/\/$/, '')}/feeds/posts/default`;
            feed = await parser.parseURL(defaultRssUrl);
        }

        const posts = feed.items || [];
        console.log(`✅ Found ${posts.length} posts via RSS`);
        return posts;
    } catch (error) {
        console.error('❌ Error getting posts from RSS:', error.message);
        return [];
    }
}

// Alternative: HTML scraping se posts get karna
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
        
        // Post URLs extract karein (common patterns)
        const postUrlPatterns = [
            /href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g,
            /href="([^"]*\/p\/[^"]*\.html)"/g,
            /<a[^>]*href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*)"[^>]*>/g
        ];

        const posts = [];
        const seenUrls = new Set();

        for (const pattern of postUrlPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let url = match[1];
                
                // Relative URL ko absolute mein convert karein
                if (url.startsWith('/')) {
                    const blogBase = new URL(BLOG_URL).origin;
                    url = blogBase + url;
                }
                
                // Duplicate check karein
                if (!seenUrls.has(url) && url.includes('http')) {
                    seenUrls.add(url);
                    posts.push({ url: url });
                }
            }
        }

        console.log(`✅ Found ${posts.length} posts via HTML`);
        return posts.slice(0, 20); // Last 20 posts
    } catch (error) {
        console.error('❌ Error getting posts from HTML:', error.message);
        return [];
    }
}

// Function to index a URL using Google Indexing API
async function indexUrl(url) {
    try {
        // Agar already indexed hai to skip karo
        if (indexedUrls.has(url)) {
            console.log(`⏭️ Already indexed: ${url}`);
            return { success: true, skipped: true, url: url };
        }

        console.log(`🔍 Indexing URL: ${url}`);
        
        const response = await indexing.urlNotifications.publish({
            auth: indexingAuth,
            requestBody: {
                url: url,
                type: 'URL_UPDATED'
            }
        });

        console.log(`✅ Successfully indexed: ${url}`);
        
        // Track kar lo indexed URLs
        indexedUrls.add(url);
        
        return { 
            success: true, 
            url: url, 
            response: response.data 
        };
    } catch (error) {
        console.error(`❌ Error indexing URL: ${url}`, error.response?.data || error.message);
        return { 
            success: false, 
            url: url, 
            error: error.message 
        };
    }
}

// Main function to check and index new posts
async function checkAndIndexNewPosts() {
    try {
        console.log('\n🚀 Starting Google Indexing Check...');
        console.log(`⏰ Time: ${new Date().toISOString()}`);
        
        // Pehle RSS feed try karein
        let latestPosts = await getLatestPosts();
        
        // Agar RSS fail ho to HTML scraping try karein
        if (latestPosts.length === 0) {
            console.log('🔄 Trying HTML scraping...');
            latestPosts = await getPostsFromHTML();
        }
        
        if (latestPosts.length === 0) {
            console.log('❌ No posts found to index');
            return;
        }

        const results = [];
        
        // Har post ko index karo
        for (const post of latestPosts) {
            const postUrl = post.url || post.link;
            
            if (!postUrl) continue;
            
            const result = await indexUrl(postUrl);
            results.push(result);
            
            // 1 second wait between requests (rate limiting)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Results summary
        const successful = results.filter(r => r.success && !r.skipped).length;
        const skipped = results.filter(r => r.skipped).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`\n📊 Indexing Summary:`);
        console.log(`✅ Newly Indexed: ${successful}`);
        console.log(`⏭️ Already Indexed: ${skipped}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📝 Total Checked: ${results.length}`);
        
        return results;
    } catch (error) {
        console.error('❌ Indexing process error:', error);
        throw error;
    }
}

// Cron job - har 3 ghante mein check karega
cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n🕒 Scheduled check started at: ${new Date().toISOString()}`);
    await checkAndIndexNewPosts();
});

// Startup message
console.log('🚀 Blogger Auto Indexer Started!');
console.log('⏰ Will check every 3 hours for new posts');

// First run on startup
setTimeout(() => {
    checkAndIndexNewPosts();
}, 5000);
