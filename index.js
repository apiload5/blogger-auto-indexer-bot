const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron'); // Cron Library
const Parser = require('rss-parser');
const { URL } = require('url'); 

// 🔑🔑 FIX: OpenSSL 3.0 error:1E08010C ko hal karne ke liye 🔑🔑
require('https').globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1'; 

// Environment variables
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, 
    RSS_FEED_URL, 
} = process.env;

// CONSTANTS
const MAX_URLS_TO_SUBMIT = 25; // Aik waqt me zyada se zyada itne URLs submit karega
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds delay (Rate Limiting)

// RSS Parser initialize
const parser = new Parser();
const indexing = google.indexing('v3');

// ✅ FIX: 'new new' ko 'new' mein theek kiya gaya hai
const indexingAuth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/indexing'],
    null
);

// =================================================================
// ## Post Fetching Logic (Same Functions)
// =================================================================

async function getPostsFromHTML() {
    try {
        console.log('🌐 Checking blog via HTML...');
        const response = await axios.get(BLOG_URL, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
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
                if (url.startsWith('/')) { url = blogBase + url; }
                if (!seenUrls.has(url) && url.includes('http') && url.includes('.html') && !url.includes('search?q=')) {
                    seenUrls.add(url);
                    posts.push({ url: url, title: `Post from ${new URL(url).pathname}` });
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
        const posts = feed.items || [];
        console.log(`✅ Found ${posts.length} posts via RSS`);
        return posts;
    } catch (error) {
        console.error('❌ RSS Error:', error.message);
        console.log('🔄 Falling back to HTML scraping...');
        return await getPostsFromHTML();
    }
}


// =================================================================
// ## Indexing Logic
// =================================================================

async function indexUrl(url) {
    try {
        console.log(`🔍 Submitting URL: ${url}`);
        
        const response = await indexing.urlNotifications.publish({
            auth: indexingAuth,
            requestBody: { url: url, type: 'URL_UPDATED' }
        });

        console.log(`✅ Successfully submitted: ${url}`);
        return { success: true, url: url, response: response.data };
    } catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        
        if (errorMessage.includes('Quota exceeded')) {
             console.error('🚨🚨 QUOTA EXCEEDED. Stopping job. Remaining URLs will be checked next time.');
             throw new Error('Quota Exceeded'); 
        }
        
        console.error(`❌ Error submitting URL: ${url}`, errorMessage);
        return { success: false, url: url, error: errorMessage };
    }
}

async function checkAndIndexNewPosts() {
    let results = [];
    try {
        console.log('\n🚀 Starting Google Indexing Check...');
        
        const latestPosts = await getLatestPosts();
        
        if (latestPosts.length === 0) {
            console.log('❌ No posts found to submit');
            return;
        }

        const postsToSubmit = latestPosts.slice(0, MAX_URLS_TO_SUBMIT);
        console.log(`📦 Filtering: Submitting top ${postsToSubmit.length} posts for quick indexing...`);
        console.log('💡 Note: URLs are re-submitted to ensure quick indexing status.');

        for (const post of postsToSubmit) {
            const postUrl = post.url || post.link;
            if (!postUrl) continue;
            
            try {
                const result = await indexUrl(postUrl);
                results.push(result);

                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
            } catch (error) {
                if (error.message.includes('Quota Exceeded')) {
                     results.push({ success: false, url: postUrl, error: 'Quota Exceeded' });
                     break; 
                }
            }
        }
        
        const submitted = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const postsFound = latestPosts.length;
        const urlsRemaining = Math.max(0, postsFound - postsToSubmit.length);
        
        console.log(`\n==============================================`);
        console.log(`📊 INDEXING RUN SUMMARY: ${new Date().toLocaleTimeString()}`);
        console.log(`==============================================`);
        console.log(`✅ Newly Submitted/Updated: ${submitted}`);
        console.log(`❌ Failed (Errors): ${failed}`);
        
        if (failed > 0 && results.some(r => r.error && r.error.includes('Quota Exceeded'))) {
            console.log(`🚨🚨 STOPPED EARLY: Quota exceeded. ${urlsRemaining} URLs remaining for the next scheduled run.`);
        } else if (postsFound > MAX_URLS_TO_SUBMIT) {
            console.log(`⭐ NOTE: Only the top ${MAX_URLS_TO_SUBMIT} URLs were processed. ${urlsRemaining} URLs remaining.`);
        } else {
             console.log(`🟢 Status: Job Complete. All ${postsToSubmit.length} posts submitted.`);
        }
        
        console.log(`==============================================`);
    } catch (error) {
        console.error('❌ Critical Indexing Process Error:', error.message);
    }
}

// =================================================================
// ## Startup aur Mode Selection (Yahan tabdeeli karein)
// =================================================================

console.log('🚀 Indexer Application Starting...');

// ----------------------------------------------------------------------------------
// 💡 KAISE CHALAAYEIN: 
// Sirf ek (1) MODE (A ya B) ko uncomment (zinda) rakhein aur doosre ko comment (band) kar dein.
// ----------------------------------------------------------------------------------


// ➡️ MODE A: SIRF EK BAAR CHALKAR RUK JAYE (Testing / GitHub Actions / Mode Once)
/*
checkAndIndexNewPosts(); 
*/

// ➡️ MODE B: SCHEDULE CHALTA RAHE (24/7 Automation for Replit Always On)
const CHECK_INTERVAL = '0 */3 * * *'; // Har 3 ghante mein run karega (Aap yahan badal sakte hain)

console.log(`⏰ Scheduler Mode: Will check every 3 hours.`);

cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n\n==============================================`);
    console.log(`🕒 SCHEDULED RUN STARTED...`);
    console.log(`==============================================`);
    await checkAndIndexNewPosts();
});

// Immediate run on startup (Schedule Mode mein shuruat mein bhi chalta hai)
checkAndIndexNewPosts();
