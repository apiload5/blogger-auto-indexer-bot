const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');
const { URL } = require('url');
const https = require('https');
const tls = require('tls');

// =================================================================
// ## COMPREHENSIVE SSL FIX - Multiple Approaches
// =================================================================

// Approach 1: Global agent with reduced security (Primary Fix)
const httpsAgent = new https.Agent({
    secureOptions: tls.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    ciphers: 'DEFAULT@SECLEVEL=1',
    minVersion: 'TLSv1',
    rejectUnauthorized: false // Use with caution
});

// Approach 2: Environment variable fix
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Approach 3: For axios requests
const axiosInstance = axios.create({
    httpsAgent: httpsAgent,
    timeout: 15000
});

// Global axios defaults
axios.defaults.httpsAgent = httpsAgent;

// Environment variables
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, 
    RSS_FEED_URL,
} = process.env;

// CONSTANTS
const MAX_URLS_TO_SUBMIT = 25;
const DELAY_BETWEEN_REQUESTS = 2000;

// RSS Parser initialize with custom httpsAgent
const parser = new Parser({
    timeout: 10000,
    customFields: {
        item: ['pubDate', 'link', 'title', 'content']
    },
    requestOptions: {
        agent: httpsAgent
    }
});

const indexing = google.indexing('v3');

// ✅ Google Auth with SSL fix
const indexingAuth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/indexing'],
    null
);

// Set custom agent for Google APIs
indexingAuth.agent = httpsAgent;

// =================================================================
// ## Modified Post Fetching Functions with SSL Fix
// =================================================================

async function getPostsFromHTML() {
    try {
        console.log('🌐 Checking blog via HTML...');
        const response = await axiosInstance.get(BLOG_URL, {
            timeout: 10000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            httpsAgent: httpsAgent
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
        
        // RSS parsing with SSL fix
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
// ## Modified Indexing Function with SSL Fix
// =================================================================

async function indexUrl(url) {
    try {
        console.log(`🔍 Submitting URL: ${url}`);
        
        // Google API call with custom agent
        const response = await indexing.urlNotifications.publish({
            auth: indexingAuth,
            requestBody: { 
                url: url, 
                type: 'URL_UPDATED' 
            },
            http2: false // HTTP2 disable karein
        });

        console.log(`✅ Successfully submitted: ${url}`);
        return { success: true, url: url, response: response.data };
    } catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        
        // Special SSL error handling
        if (errorMessage.includes('1E08010C') || errorMessage.includes('unsupported') || errorMessage.includes('DECODER')) {
            console.error(`🔒 SSL Error detected for: ${url}`);
            console.log('🔄 Retrying with alternative SSL configuration...');
            
            // Retry logic with different approach
            return await retryIndexUrl(url);
        }
        
        if (errorMessage.includes('Quota exceeded')) {
             console.error('🚨🚨 QUOTA EXCEEDED. Stopping job.');
             throw new Error('Quota Exceeded'); 
        }
        
        console.error(`❌ Error submitting URL: ${url}`, errorMessage);
        return { success: false, url: url, error: errorMessage };
    }
}

// Alternative indexing function for SSL retry
async function retryIndexUrl(url) {
    try {
        console.log(`🔄 Retrying URL with SSL fix: ${url}`);
        
        // Alternative auth without agent
        const retryAuth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/indexing'],
            null
        );

        const response = await indexing.urlNotifications.publish({
            auth: retryAuth,
            requestBody: { 
                url: url, 
                type: 'URL_UPDATED' 
            },
            retry: true,
            retryConfig: {
                retry: 3,
                retryDelay: 1000
            }
        });

        console.log(`✅ Successfully submitted (retry): ${url}`);
        return { success: true, url: url, response: response.data };
    } catch (retryError) {
        console.error(`❌ Retry failed for: ${url}`, retryError.message);
        return { success: false, url: url, error: retryError.message };
    }
}

// =================================================================
// ## Node.js Version Check & Compatibility
// =================================================================

function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(process.versions.node.split('.')[0]);
    
    console.log(`🔧 Node.js Version: ${nodeVersion}`);
    
    if (majorVersion >= 17) {
        console.log('⚠️  Node.js 17+ detected - SSL issues possible');
        console.log('💡 Solution: Using legacy SSL configuration');
    } else {
        console.log('✅ Node.js version compatible');
    }
}

// =================================================================
// ## Main Indexing Logic
// =================================================================

async function checkAndIndexNewPosts() {
    let results = [];
    try {
        console.log('\n🚀 Starting Google Indexing Check...');
        
        // Node version check
        checkNodeVersion();
        
        const latestPosts = await getLatestPosts();
        
        if (latestPosts.length === 0) {
            console.log('❌ No posts found to submit');
            return;
        }

        const postsToSubmit = latestPosts.slice(0, MAX_URLS_TO_SUBMIT);
        console.log(`📦 Filtering: Submitting top ${postsToSubmit.length} posts`);
        console.log('🔒 Using SSL-fixed configuration...');

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
        
        console.log(`\n==============================================`);
        console.log(`📊 INDEXING RUN SUMMARY: ${new Date().toLocaleTimeString()}`);
        console.log(`==============================================`);
        console.log(`✅ Successfully submitted: ${submitted}`);
        console.log(`❌ Failed: ${failed}`);
        
        if (failed > 0) {
            const sslErrors = results.filter(r => r.error && r.error.includes('1E08010C')).length;
            if (sslErrors > 0) {
                console.log(`🔒 SSL Errors: ${sslErrors} - Consider updating Node.js or OpenSSL`);
            }
        }
        
        console.log(`==============================================`);
    } catch (error) {
        console.error('❌ Critical Indexing Process Error:', error.message);
    }
}

// =================================================================
// ## Application Startup
// =================================================================

console.log('🚀 Indexer Application Starting with SSL Fix...');

// Node.js compatibility settings
process.env.NODE_OPTIONS = '--openssl-legacy-provider';

// ➡️ MODE A: Single Run (Testing)
/*
checkAndIndexNewPosts(); 
*/

// ➡️ MODE B: Scheduled (Production)
const CHECK_INTERVAL = '0 */3 * * *';

console.log(`⏰ Scheduler Mode: Will check every 3 hours.`);

cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n\n==============================================`);
    console.log(`🕒 SCHEDULED RUN STARTED...`);
    console.log(`==============================================`);
    await checkAndIndexNewPosts();
});

// Immediate run on startup
checkAndIndexNewPosts();
