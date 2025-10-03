const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');

// 🔑🔑 FIX: OpenSSL 3.0 error:1E08010C ko hal karne ke liye 🔑🔑
// Ye line Node.js ko legacy ciphers (SECLEVEL=1) istemal karne ki ijazat deti hai.
require('https').globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1'; 

// Environment variables - From GitHub Secrets
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, // REQUIRED - Sirf yeh chahiye
    RSS_FEED_URL, // OPTIONAL - Nah bhi ho to chalega
    CHECK_INTERVAL = '0 */1 * * *' // Default to 3 hours
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

// Track already indexed URLs
let indexedUrls = new Set();

// Function to get latest posts - Automatic RSS URL Generation
async function getLatestPosts() {
    try {
        console.log('📝 Checking for new posts...');
        
        let feed;
        let rssUrl;
        
        // Agar RSS_FEED_URL provide kiya hai to use karo
        if (RSS_FEED_URL) {
            rssUrl = RSS_FEED_URL;
            console.log(`📡 Using custom RSS feed: ${rssUrl}`);
        } else {
            // Automatically generate RSS URL from BLOG_URL
            rssUrl = `${BLOG_URL.replace(/\/$/, '')}/feeds/posts/default?alt=rss`;
            console.log(`📡 Using auto-generated RSS feed: ${rssUrl}`);
        }
        
        // Yahan 'parser.parseURL' mein Axios/HTTPS request hota hai
        feed = await parser.parseURL(rssUrl);
        const posts = feed.items || [];
        
        console.log(`✅ Found ${posts.length} posts via RSS`);
        return posts;
        
    } catch (error) {
        // ERROR LOGGING BAHUT AHEM HAI
        console.error('❌ RSS Error:', error.message);
        console.log('🔄 Falling back to HTML scraping...');
        return await getPostsFromHTML();
    }
}

// HTML scraping fallback
async function getPostsFromHTML() {
    try {
        console.log('🌐 Checking blog via HTML...');
        
        // Yahan bhi Axios istemal ho raha hai
        const response = await axios.get(BLOG_URL, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;
        
        // Common Blogger post URL patterns
        const postUrlPatterns = [
            /href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g,
            /href="([^"]*\/p\/[^"]*\.html)"/g,
            /<a[^>]*href="([^"]*\/[0-9]{4}\/[0-9]{2}\/[^"]*)"[^>]*>/g,
            /href="(https:\/\/[^"]*\.blogspot\.com\/[0-9]{4}\/[0-9]{2}\/[^"]*\.html)"/g
        ];

        const posts = [];
        const seenUrls = new Set();

        for (const pattern of postUrlPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let url = match[1];
                
                // Relative URL ko absolute mein convert karo
                if (url.startsWith('/')) {
                    const blogBase = new URL(BLOG_URL).origin;
                    url = blogBase + url;
                }
                
                // Duplicate check karo aur valid URL filter karo
                if (!seenUrls.has(url) && 
                    url.includes('http') && 
                    url.includes('.html') &&
                    !url.includes('search?q=')) {
                    seenUrls.add(url);
                    posts.push({ 
                        url: url,
                        title: `Post from ${new URL(url).pathname}`
                    });
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
        // Google Indexing API error yahan catch hoga
        console.error(`❌ Error indexing URL: ${url}`, error.response?.data?.error?.message || error.message);
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
        console.log(`🔗 Blog URL: ${BLOG_URL}`);
        
        // Latest posts get karo
        const latestPosts = await getLatestPosts();
        
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
            
            // 2 second wait between requests (rate limiting)
            await new Promise(resolve => setTimeout(resolve, 2000));
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
// Ye CHECK_INTERVAL ki qeemat se check karega
const intervalParts = CHECK_INTERVAL.split(' ');
const hours = intervalParts.length > 1 && intervalParts[1].startsWith('*/') ? intervalParts[1].replace('*/', '') : '3';
console.log(`⏰ Will check every ${hours} hours for new posts`);

// First run on startup
setTimeout(() => {
    checkAndIndexNewPosts();
}, 5000);
