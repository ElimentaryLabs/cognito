// Background service worker for Cognito
console.log('🚀 Cognito AI background service worker starting...');

// Listen for installation
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      console.log('Cognito installed');
      
      // Initialize storage
      chrome.storage.sync.set({
        comments: [],
        settings: {
          autoSync: true,
          showBubbles: true
        }
      });
    }
  } catch (error) {
    console.error('Error in onInstalled listener:', error);
  }
});
  
// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // The content script can no longer render the configuration dialogs itself: they
    // carried API keys, a Jira token and database credentials in inputs that shared the
    // host page's DOM. It asks the service worker to open the settings page instead,
    // since chrome.runtime.openOptionsPage is not available from a content script.
    if (request.action === 'openOptions') {
      chrome.runtime.openOptionsPage(() => {
        sendResponse({ success: !chrome.runtime.lastError });
      });
      return true;
    }

    if (request.action === 'getComments') {
      chrome.storage.sync.get('comments', (result) => {
        sendResponse({ comments: result.comments || [] });
      });
      return true; // Keep channel open for async response
    }
    
    if (request.action === 'saveComment') {
      chrome.storage.sync.get('comments', (result) => {
        const comments = result.comments || [];
        comments.push(request.comment);
        
        chrome.storage.sync.set({ comments }, () => {
          sendResponse({ success: true });
        });
      });
      return true;
    }
    
    if (request.action === 'deleteComment') {
      chrome.storage.sync.get('comments', (result) => {
        const comments = result.comments || [];
        const filtered = comments.filter(c => c.id !== request.commentId);
        
        chrome.storage.sync.set({ comments: filtered }, () => {
          sendResponse({ success: true });
        });
      });
      return true;
    }
    
    // Handle external API requests (to bypass CORS)
    if (request.action === 'fetchAPI') {
      const { url, options } = request;
      
      const requestTime = Date.now();
      const requestTimeISO = new Date().toISOString();
      
      // Determine service type for better logging
      let serviceType = 'UNKNOWN';
      if (url && url.includes('supabase')) {
        serviceType = 'SUPABASE';
      } else if (url && url.includes('atlassian') || url && url.includes('jira')) {
        serviceType = 'JIRA';
      } else if (url && url.includes('openai.com')) {
        serviceType = 'OPENAI';
      } else if (url && url.includes('anthropic.com')) {
        serviceType = 'ANTHROPIC';
      } else if (url && url.includes('googleapis.com') || url && url.includes('gemini')) {
        serviceType = 'GEMINI';
      } else if (url && url.includes('mongodb')) {
        serviceType = 'MONGODB';
      }
      
      console.log(`🔗 [${serviceType}] Background: Making API request at:`, requestTimeISO);
      console.log(`🔗 [${serviceType}] Background: URL:`, url);
      console.log(`🔗 [${serviceType}] Background: Method:`, options?.method || 'GET');
      console.log(`🔗 [${serviceType}] Background: Headers:`, Object.keys(options?.headers || {}));
      
      // Log if this is a Supabase health check
      if (url && url.includes('/auth/v1/health')) {
        console.log('🔗 [SUPABASE] Background: This is a Supabase health check - should appear in API Gateway or Auth logs');
      }
      
      // Validate request first
      if (!url) {
        sendResponse({ success: false, error: 'Missing URL in request' });
        return true;
      }
      
      if (!options) {
        sendResponse({ success: false, error: 'Missing options in request' });
        return true;
      }
      
      // Store sendResponse to ensure it's available in async context
      let responseSent = false;
      const safeSendResponse = (response) => {
        if (!responseSent) {
          responseSent = true;
          try {
            sendResponse(response);
          } catch (e) {
            console.error(`🔗 [${serviceType}] Background: Error sending response:`, e);
          }
        }
      };
      
      // Execute fetch immediately - don't wrap in async IIFE that might delay
      // This ensures the service worker stays active and the message channel stays open
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        const totalElapsed = Date.now() - requestTime;
        console.error(`🔗 [${serviceType}] Background: Request timeout after 30 seconds (${totalElapsed}ms elapsed)`);
        controller.abort();
        if (!responseSent) {
          safeSendResponse({ success: false, error: 'Request timeout after 30 seconds' });
        }
      }, 30000); // 30 second timeout
      
      const fetchStartTime = Date.now();
      console.log(`🔗 [${serviceType}] Background: Executing fetch() now...`);
      
      fetch(url, {
        ...options,
        signal: controller.signal
      })
      .then(async (response) => {
        clearTimeout(timeoutId);
        const fetchElapsed = Date.now() - requestTime;
        const responseTime = new Date().toISOString();
        
        console.log(`🔗 [${serviceType}] Background: Response status:`, response.status);
        console.log(`🔗 [${serviceType}] Background: Response received at:`, responseTime);
        console.log(`🔗 [${serviceType}] Background: Response received in ${fetchElapsed}ms`);
        console.log(`🔗 [${serviceType}] Background: Response headers:`, [...response.headers.entries()].slice(0, 5));
        
        // Log for Supabase health checks
        if (url && url.includes('/auth/v1/health')) {
          console.log('🔗 [SUPABASE] Background: ✅ Supabase health check completed - check API Gateway logs in Supabase dashboard');
        }
        
        // Read response body once
        const contentType = response.headers.get('content-type');
        let responseText = null;
        let data = null;
        
        try {
          responseText = await response.text();
        } catch (e) {
          console.error(`🔗 [${serviceType}] Background: Error reading response text:`, e);
          safeSendResponse({ success: false, error: 'Failed to read response body' });
          return;
        }
        
        if (!response.ok) {
          const totalElapsed = Date.now() - requestTime;
          console.error(`🔗 [${serviceType}] Background: API Error (${totalElapsed}ms):`, response.status, responseText.substring(0, 200));
          safeSendResponse({ success: false, error: `HTTP ${response.status}: ${responseText.substring(0, 200)}` });
          return;
        }
        
        // Try to parse as JSON if content type suggests it
        if (contentType && contentType.includes('application/json')) {
          try {
            data = JSON.parse(responseText);
            console.log(`🔗 [${serviceType}] Background: Successfully parsed JSON response`);
          } catch (e) {
            // If JSON parsing fails, use text as message
            console.log(`🔗 [${serviceType}] Background: JSON parse failed, using text:`, e);
            data = { message: responseText.substring(0, 200) };
          }
        } else {
          // For non-JSON responses, wrap in object
          console.log(`🔗 [${serviceType}] Background: Non-JSON response:`, responseText.substring(0, 200));
          data = { message: responseText.substring(0, 200) };
        }
        
        const totalElapsed = Date.now() - requestTime;
        console.log(`🔗 [${serviceType}] Background: ✅ API Success (${totalElapsed}ms)`, typeof data === 'object' ? Object.keys(data).slice(0, 3) : 'data');
        safeSendResponse({ success: true, data });
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        const totalElapsed = Date.now() - requestTime;
        console.error(`🔗 [${serviceType}] Background: ❌ API Error (${totalElapsed}ms):`, error.name, error.message);
        
        // Check if it's an abort error (timeout)
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          console.error(`🔗 [${serviceType}] Background: Request was aborted (timeout)`);
          safeSendResponse({ success: false, error: 'Request timeout after 30 seconds' });
        } else {
          console.error(`🔗 [${serviceType}] Background: Network or other error:`, error);
          safeSendResponse({ success: false, error: error.message || 'Unknown error' });
        }
      });
      
      return true; // Keep channel open for async response
    }
  } catch (error) {
    console.error('Error in message listener:', error);
    sendResponse({ success: false, error: error.message });
  }
});
  
// Handle tab updates to inject content script on Power BI pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status === 'complete' && tab.url) {
      if (tab.url.includes('powerbi.com')) {
        console.log('Power BI page detected');
      }
    }
  } catch (error) {
    console.error('Error in tab update listener:', error);
  }
});