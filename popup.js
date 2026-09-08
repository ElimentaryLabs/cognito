// Popup script for Cognito AI

document.addEventListener('DOMContentLoaded', async () => {
    // Load and display statistics
    loadStats();
    
    // Check permissions and content script status first
    await checkPermissionsAndStatus();
    
    // Toggle sidebar button
    document.getElementById('toggle-sidebar').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if content script is running
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        if (response && response.status === 'ready') {
          chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
          window.close();
        } else {
          showPermissionInstructions();
        }
      } catch (error) {
        // Content script not running - show permission instructions
        showPermissionInstructions();
      }
    });
    
    // Export data button
    document.getElementById('export-data').addEventListener('click', exportComments);

    // Settings button - profile, database, Jira and AI configuration all live on the
    // extension's own options page rather than in the injected sidebar.
    document.getElementById('open-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
  });
  
  async function loadStats() {
    const result = await chrome.storage.sync.get('comments');
    const comments = result.comments || [];
    
    const totalComments = comments.length;
    const bubbleComments = comments.filter(c => c.type === 'bubble').length;
    const pageNotes = comments.filter(c => c.type === 'page').length;
    
    document.getElementById('total-comments').textContent = totalComments;
    document.getElementById('bubble-comments').textContent = bubbleComments;
    document.getElementById('page-notes').textContent = pageNotes;
  }
  
  async function checkPermissionsAndStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const statusContainer = document.querySelector('.status');
    
    // Check if we can access the tab
    if (!tab || !tab.url) {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Cannot access page';
      return;
    }
    
    // Check if it's a special page (chrome://, chrome-extension://, etc.)
    const url = tab.url;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || 
        url.startsWith('edge://') || url.startsWith('about:')) {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not available on this page';
      return;
    }
    
    // Try to ping the content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (response && response.status === 'ready') {
        statusDot.classList.remove('inactive');
        statusText.textContent = 'Extension Active';
        hidePermissionInstructions();
      } else {
        throw new Error('No response');
      }
    } catch (error) {
      // Content script not running - check permissions
      statusDot.classList.add('inactive');
      statusText.textContent = 'Extension not active';
      showPermissionInstructions();
    }
  }
  
  function showPermissionInstructions() {
    let instructionsDiv = document.getElementById('permission-instructions');
    if (!instructionsDiv) {
      instructionsDiv = document.createElement('div');
      instructionsDiv.id = 'permission-instructions';
      instructionsDiv.className = 'permission-instructions';
      instructionsDiv.innerHTML = `
        <div class="permission-content">
          <h3>🔒 Enable Extension Permissions</h3>
          <p>The extension needs permission to run on this page.</p>
          <ol>
            <li>Click the extension icon in your browser toolbar</li>
            <li>Click "Always allow on this site" or "Allow"</li>
            <li>Refresh this page</li>
          </ol>
          <p><strong>Alternative:</strong> Go to <code>chrome://extensions</code>, find "Cognito AI", and ensure "Allow access to file URLs" is enabled if needed.</p>
          <button class="btn btn-primary" id="refresh-page" style="margin-top: 12px; width: 100%;">Refresh Page</button>
        </div>
      `;
      
      const statusContainer = document.querySelector('.status');
      statusContainer.insertAdjacentElement('afterend', instructionsDiv);
      
      // Add refresh button handler
      document.getElementById('refresh-page').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.reload(tab.id);
        window.close();
      });
    }
    instructionsDiv.style.display = 'block';
  }
  
  function hidePermissionInstructions() {
    const instructionsDiv = document.getElementById('permission-instructions');
    if (instructionsDiv) {
      instructionsDiv.style.display = 'none';
    }
  }
  
  async function exportComments() {
    const result = await chrome.storage.sync.get('comments');
    const comments = result.comments || [];
    
    if (comments.length === 0) {
      alert('No comments to export');
      return;
    }
    
    // Convert to CSV
    const csv = convertToCSV(comments);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    // Download
    const a = document.createElement('a');
    a.href = url;
    a.download = `stickr-comments-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    
    URL.revokeObjectURL(url);
  }
  
  function convertToCSV(comments) {
    const headers = ['ID', 'Type', 'Comment Type', 'Page ID', 'Chart Label', 'Text', 'Link', 'Author', 'Timestamp'];
    const rows = comments.map(c => [
      c.id,
      c.type,
      c.commentType || '',
      c.pageId,
      c.chartLabel || '',
      `"${c.text.replace(/"/g, '""')}"`,
      c.link || '',
      c.author,
      c.timestamp
    ]);
    
    return [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
}