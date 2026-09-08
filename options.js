// Cognito AI - settings page
//
// Everything below used to be rendered by the content script, as dialogs injected into
// whatever website the user happened to have open. Those forms carried an AI provider
// API key, a Jira API token, database connection credentials and the user's email
// address in inputs that shared the host page's DOM, so any site could read the values
// straight off the elements or watch them being typed - a type="password" field is no
// protection against script running in the same document. They now run here, on the
// chrome-extension:// origin, which no web page can reach.
//
// The four show*Dialog functions further down are a near-verbatim relocation of
// showEmailDialog / showDatabaseDialog / showJiraConfigDialog / showAIConfigDialog from
// content.js, kept close to the originals so the change reviews as a move. What changed:
// the instance state they used (this.db / this.jira / this.ai and the profile fields)
// became module state, and this.safeChromeStorage - a guard against the content script's
// extension context being torn down mid-operation - is gone, because an extension page
// cannot outlive its own context.

const db = new DatabaseAdapter();
const jira = new JiraIntegration();
const ai = new AIIntegration();

let userEmail = null;
let userRole = null;
let username = null;

// Same markup and lifecycle as the content script's toast, so the relocated save
// handlers below keep working unchanged.
function showToast(message, type = 'success', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'dc-toast';
  if (type === 'error') {
    toast.style.background = '#EF4444 !important';
  } else if (type === 'info') {
    toast.style.background = '#3B82F6 !important';
  } else if (type === 'warning') {
    toast.style.background = '#F59E0B !important';
  }
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('dc-toast-show'), 100);
  setTimeout(() => {
    toast.classList.remove('dc-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Status lines for the cards, carried over from the content script's showConfigMenu.
function describeDatabase(dbProvider) {
  if (dbProvider === 'local') return 'Currently using local storage (solo mode)';
  if (dbProvider === 'supabase') return 'Currently using Supabase';
  if (dbProvider === 'mongodb') return 'Currently using MongoDB';
  return 'Configure team collaboration database';
}

function describeAI(aiProvider) {
  if (aiProvider === 'openai') return `Currently using OpenAI (${ai.model || 'GPT-5'})`;
  if (aiProvider === 'anthropic') return `Currently using Anthropic (${ai.model || 'Claude 4.5 Sonnet'})`;
  if (aiProvider === 'gemini') return `Currently using Google Gemini (${ai.model || 'Gemini Pro'})`;
  return 'Configure AI provider for chart analysis';
}

function describeProfile() {
  if (!userEmail) return 'Add your name and role so notes are attributed to you';
  return userRole ? `${userEmail} - ${userRole}` : userEmail;
}

// Render the settings cards. Statuses are read fresh each time so the page reflects a
// save without a reload.
async function renderSettings() {
  const stored = await chrome.storage.sync.get(['dbProvider', 'aiProvider']);
  const dbProvider = stored.dbProvider || 'none';
  const aiProvider = stored.aiProvider || 'none';

  const cards = [
    {
      id: 'opt-profile',
      icon: '👤',
      title: 'Your Profile',
      desc: describeProfile(),
      status: userEmail ? '✅' : '⚙️',
      open: showEmailDialog
    },
    {
      id: 'opt-database',
      icon: '🗄️',
      title: 'Database Configuration',
      desc: describeDatabase(dbProvider),
      status: db.isConfigured ? '✅' : (dbProvider === 'local' ? '💾' : '⚙️'),
      open: showDatabaseDialog
    },
    {
      id: 'opt-jira',
      icon: `<img src="${chrome.runtime.getURL('icons/atlassian.png')}" alt="Atlassian" style="width: 24px; height: 24px;">`,
      title: 'Atlassian Integration',
      desc: 'Connect to Jira for ticket management',
      status: jira.isConfigured ? '✅' : '⚙️',
      open: showJiraConfigDialog
    },
    {
      id: 'opt-ai',
      icon: '🤖',
      title: 'AI Configuration',
      desc: describeAI(aiProvider),
      status: ai.isConfigured ? '✅' : '⚙️',
      open: showAIConfigDialog
    }
  ];

  const list = document.getElementById('opt-cards');
  list.innerHTML = cards.map(card => `
    <button class="dc-config-menu-item" id="${card.id}">
      <div class="dc-config-menu-icon">${card.icon}</div>
      <div class="dc-config-menu-text">
        <div class="dc-config-menu-title">${card.title}</div>
        <div class="dc-config-menu-desc">${escapeText(card.desc)}</div>
      </div>
      <div class="dc-config-menu-status">${card.status}</div>
    </button>
  `).join('');

  cards.forEach(card => {
    // Re-render after the dialog closes so the card reflects what was just saved. The
    // relocated dialogs resolve their promise on save and simply detach on cancel, so a
    // resolve is the only signal that something changed.
    document.getElementById(card.id).addEventListener('click', () => {
      Promise.resolve(card.open()).then(renderSettings, renderSettings);
    });
  });
}

// The card descriptions include the user's own email, so they are inserted as text.
function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  await db.init();
  await jira.init();
  await ai.init();

  const profile = await chrome.storage.sync.get(['userEmail', 'userRole']);
  if (profile.userEmail) {
    userEmail = profile.userEmail;
    userRole = profile.userRole || '';
    username = profile.userEmail.split('@')[0];
  }

  await renderSettings();
});

// Show email registration dialog
function showEmailDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dc-dialog-overlay';
    dialog.style.zIndex = '10000000';
    
    dialog.innerHTML = `
      <div class="dc-dialog" style="max-width: 600px;">
        <div class="dc-dialog-header" style="display: flex; justify-content: center; align-items: center; position: relative; border-bottom: none; padding-bottom: 0.5rem;">
          <h3 style="font-size: 24px; font-weight: 700; color: #1F2937; text-align: center; margin: 0;">Cognito AI - Intelligence made Elementary</h3>
          <button class="dc-dialog-close" id="dc-email-close" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%);">×</button>
        </div>
        <div class="dc-dialog-body">
          <p style="margin-bottom: 1.5rem; font-size: 16px; font-weight: 500; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
            ⚡ Supercharge Your Dashboards with AI-Powered Insights
          </p>
          <div style="margin-bottom: 1rem;">
            <label for="dc-email-input" style="display: block; margin-bottom: 0.5rem; font-size: 14px; font-weight: 500; color: #374151;">Email Address</label>
            <input 
              type="email" 
              id="dc-email-input" 
              class="dc-comment-input" 
              placeholder="your.email@company.com"
              style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; min-height: auto; height: auto; box-sizing: border-box;"
            >
          </div>
          <div style="margin-bottom: 1rem;">
            <label for="dc-role-input" style="display: block; margin-bottom: 0.5rem; font-size: 14px; font-weight: 500; color: #374151;">Your Role</label>
            <select 
              id="dc-role-input" 
              style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; min-height: auto; height: auto; box-sizing: border-box; background: white; cursor: pointer;"
            >
              <option value="">Select your role...</option>
              <option value="Data Analyst">Data Analyst</option>
              <option value="Business Analyst">Business Analyst</option>
              <option value="Data Scientist">Data Scientist</option>
              <option value="Product Manager">Product Manager</option>
              <option value="Engineering Manager">Engineering Manager</option>
              <option value="Executive">Executive</option>
              <option value="Operations Manager">Operations Manager</option>
              <option value="Marketing Manager">Marketing Manager</option>
              <option value="Sales Manager">Sales Manager</option>
              <option value="Finance Manager">Finance Manager</option>
              <option value="Developer">Developer</option>
              <option value="Other">Other</option>
            </select>
            <input 
              type="text" 
              id="dc-role-custom" 
              placeholder="Specify your role"
              style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-top: 0.5rem; min-height: auto; height: auto; box-sizing: border-box; display: none;"
            >
          </div>
          <p id="dc-email-error" style="color: #EF4444; font-size: 12px; margin-top: 0.5rem; display: none;"></p>
        </div>
        <div class="dc-dialog-footer" style="padding-top: 1rem;">
          <button class="dc-btn dc-btn-primary" id="dc-email-submit" style="width: 100%; padding: 0.65rem 1.5rem; font-size: 15px;">
            Get Started
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    const emailInput = document.getElementById('dc-email-input');
    const roleSelect = document.getElementById('dc-role-input');
    const roleCustomInput = document.getElementById('dc-role-custom');
    const errorMsg = document.getElementById('dc-email-error');
    const submitBtn = document.getElementById('dc-email-submit');
    const closeBtn = document.getElementById('dc-email-close');
    
    // Show custom role input when "Other" is selected
    roleSelect.addEventListener('change', () => {
      if (roleSelect.value === 'Other') {
        roleCustomInput.style.display = 'block';
        roleCustomInput.focus();
      } else {
        roleCustomInput.style.display = 'none';
        roleCustomInput.value = '';
      }
    });
    
    // Close button handler
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      // Don't resolve or reject - just exit the flow completely
    });
    
    emailInput.focus();
    
    const validateAndSubmit = async () => {
      const email = emailInput.value.trim();
      const role = roleSelect.value === 'Other' 
        ? roleCustomInput.value.trim() 
        : roleSelect.value;
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!email || !emailRegex.test(email)) {
        errorMsg.textContent = 'Please enter a valid email address';
        errorMsg.style.display = 'block';
        emailInput.style.borderColor = '#EF4444';
        return;
      }
      
      if (!role) {
        errorMsg.textContent = 'Please select or specify your role';
        errorMsg.style.display = 'block';
        roleSelect.style.borderColor = '#EF4444';
        return;
      }
      
      // Save email and role
      userEmail = email;
      userRole = role;
      username = email.split('@')[0];
        await chrome.storage.sync.set({
          userEmail: email,
          userRole: role
        });
      
      console.log('✅ User registered:', username, 'Role:', role);
      dialog.remove();
      resolve();
    };
    
    submitBtn.addEventListener('click', validateAndSubmit);
    
    const handleEnterKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        validateAndSubmit();
      }
    };
    
    emailInput.addEventListener('keydown', handleEnterKey);
    roleSelect.addEventListener('keydown', handleEnterKey);
    roleCustomInput.addEventListener('keydown', handleEnterKey);
    
    emailInput.addEventListener('input', () => {
      errorMsg.style.display = 'none';
      emailInput.style.borderColor = '#ddd';
    });
    
    roleSelect.addEventListener('input', () => {
      errorMsg.style.display = 'none';
      roleSelect.style.borderColor = '#ddd';
    });
    
    roleCustomInput.addEventListener('input', () => {
      errorMsg.style.display = 'none';
      roleCustomInput.style.borderColor = '#ddd';
    });
  });
}

// Show database configuration dialog
function showDatabaseDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dc-dialog-overlay';
    dialog.style.zIndex = '10000000';
    
    dialog.innerHTML = `
      <div class="dc-dialog" style="max-width: 550px; max-height: 80vh; display: flex; flex-direction: column;">
        <div class="dc-dialog-header" style="padding: 1rem 1.25rem 0.75rem;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #1F2937;">🗄️ Database Configuration</h3>
          <p style="margin: 0.5rem 0 0; color: #6B7280; font-size: 12px; line-height: 1.4;">
            Choose your database provider for team collaboration
          </p>
        </div>
        <div class="dc-dialog-body" style="max-height: calc(80vh - 130px); overflow-y: auto; padding: 0 1.25rem;">
          
          <!-- Radio Button Provider Selection -->
          <div style="display: flex; gap: 0.75rem; margin-bottom: 1.5rem; margin-top: 1rem; flex-wrap: wrap; justify-content: center;">
            <div id="dc-local-storage-option" class="db-provider-radio" style="cursor: pointer;">
              <div class="db-provider-card">
                <div class="db-provider-icon">💾</div>
                <div class="db-provider-name">Local Storage</div>
                <div class="db-provider-tag">Solo Mode</div>
              </div>
            </div>
            
            <label class="db-provider-radio">
              <input type="radio" name="db-provider" value="supabase" style="display: none;">
              <div class="db-provider-card">
                <div class="db-provider-icon">🚀</div>
                <div class="db-provider-name">Supabase</div>
                <div class="db-provider-tag">Recommended</div>
              </div>
            </label>
            
            <label class="db-provider-radio">
              <input type="radio" name="db-provider" value="mongodb" style="display: none;">
              <div class="db-provider-card">
                <div class="db-provider-icon">🍃</div>
                <div class="db-provider-name">MongoDB Atlas</div>
                <div class="db-provider-tag">NoSQL</div>
              </div>
            </label>
          </div>
          
          <!-- Supabase Form -->
          <div id="form-supabase" class="db-form" style="display: none;">
            <div class="db-setup-guide">
              <div class="db-setup-guide-title">📚 Supabase Setup Steps:</div>
              <ol>
                <li>Go to <a href="https://supabase.com" target="_blank" style="color: #0066cc; font-weight: 500;">supabase.com</a> and create a free account</li>
                <li>Click <strong>"New Project"</strong> and fill in project details</li>
                <li>Once created, go to <strong>Settings → API</strong></li>
                <li>Copy the <strong>"Project URL"</strong> (looks like https://xxxxx.supabase.co)</li>
                <li>Copy the <strong>"anon public"</strong> API key</li>
                <li>Go to <strong>SQL Editor</strong> and run this SQL:
                  <div style="position: relative; margin-top: 0.75rem;">
                    <button class="dc-copy-sql-btn" id="dc-copy-sql-btn" title="Copy SQL command" style="position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(255, 255, 255, 0.9); border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.375rem 0.5rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; font-size: 11px; color: #6B7280; transition: all 0.2s; z-index: 10;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                      <span class="dc-copy-text">Copy</span>
                    </button>
                    <pre id="dc-sql-command">CREATE TABLE cognito_comments (
  id TEXT PRIMARY KEY,
  text TEXT,
  link TEXT,
  "commentType" TEXT,
  type TEXT,
  timestamp TEXT,
  author TEXT,
  "pageId" TEXT,
  "parentId" TEXT,
  replies JSONB,
  "chartHash" TEXT,
  "chartLabel" TEXT,
  "relativeX" REAL,
  "relativeY" REAL,
  "filterState" JSONB,
  "jiraTicket" JSONB,
  "targetId" TEXT,
  "targetPath" TEXT
);</pre>
                  </div>
                </li>
                <li>Enter your Project URL and API Key below</li>
              </ol>
            </div>
            
            <div class="db-form-field">
              <label class="db-form-label">Supabase Project URL</label>
              <input 
                type="url" 
                id="dc-supabase-url" 
                class="db-form-input" 
                placeholder="https://xxxxx.supabase.co"
              >
            </div>
            
            <div class="db-form-field">
              <label class="db-form-label">Supabase API Key (anon public)</label>
              <div style="position: relative;">
                <input 
                  type="password" 
                  id="dc-supabase-key" 
                  class="db-form-input" 
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  style="padding-right: 2.5rem;"
                >
                <button type="button" class="dc-toggle-password" id="dc-toggle-supabase-key" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; color: #6B7280; transition: color 0.2s;" title="Show/Hide API Key">
                  <svg id="dc-eye-icon-supabase-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <svg id="dc-eye-off-icon-supabase-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                </button>
              </div>
            </div>
            
            <div id="dc-db-loader" style="display: none; margin-top: 0.75rem; padding: 0.75rem; background: #F3F4F6; border-radius: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div class="dc-loading-spinner" style="width: 16px; height: 16px; border: 2px solid #E5E7EB; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                  <span style="font-size: 12px; color: #6B7280; font-weight: 500;">Testing connection...</span>
                </div>
                <button type="button" class="dc-copy-logs-btn" id="dc-copy-db-logs-btn-supabase" style="display: none; background: white; border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 11px; color: #6B7280; transition: all 0.2s; display: flex; align-items: center; gap: 0.25rem;" title="Copy logs">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="dc-copy-logs-text">Copy</span>
                </button>
              </div>
              <div id="dc-db-logs" style="font-size: 11px; color: #6B7280; line-height: 1.5; max-height: 120px; overflow-y: auto; font-family: 'Monaco', 'Courier New', monospace; background: white; padding: 0.5rem; border-radius: 4px; border: 1px solid #E5E7EB; white-space: pre-wrap; word-wrap: break-word; text-align: left; direction: ltr;"></div>
            </div>
            <p id="dc-db-error" style="color: #EF4444; font-size: 11px; margin-top: 0.5rem; display: none;"></p>
            <p id="dc-db-success" style="color: #10B981; font-size: 11px; margin-top: 0.5rem; display: none;">✅ Connection successful!</p>
          </div>
          
          <!-- MongoDB Form -->
          <div id="form-mongodb" class="db-form" style="display: none;">
            <div class="db-setup-guide">
              <div class="db-setup-guide-title">📚 MongoDB Atlas Setup Steps:</div>
              <ol>
                <li>Go to <a href="https://www.mongodb.com/cloud/atlas/register" target="_blank" style="color: #0066cc; font-weight: 500;">mongodb.com/cloud/atlas</a> and create a free account</li>
                <li>Create a <strong>free M0 cluster</strong> (Shared tier)</li>
                <li>Set up database access: <strong>Security → Database Access → Add New User</strong></li>
                <li>Set up network access: <strong>Security → Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)</strong></li>
                <li>Enable Data API:
                  <ul>
                    <li>Go to <strong>Data API</strong> in left sidebar</li>
                    <li>Click <strong>"Enable the Data API"</strong></li>
                    <li>Copy the <strong>"URL Endpoint"</strong></li>
                    <li>Create an <strong>API Key</strong> and copy it</li>
                  </ul>
                </li>
                <li>Create database and collection:
                  <ul>
                    <li>Go to <strong>Database → Browse Collections</strong></li>
                    <li>Click <strong>"Add My Own Data"</strong></li>
                    <li>Database Name: <code style="background: #FEFCE8; padding: 0.125rem 0.25rem; border-radius: 3px;">cognito</code></li>
                    <li>Collection Name: <code style="background: #FEFCE8; padding: 0.125rem 0.25rem; border-radius: 3px;">comments</code></li>
                  </ul>
                </li>
                <li>Run this MongoDB command to create the collection structure (or use MongoDB Compass/Shell):
                  <div style="position: relative; margin-top: 0.75rem;">
                    <button class="dc-copy-sql-btn" id="dc-copy-mongo-btn" title="Copy MongoDB command" style="position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(255, 255, 255, 0.9); border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.375rem 0.5rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; font-size: 11px; color: #6B7280; transition: all 0.2s; z-index: 10;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                      <span class="dc-copy-text">Copy</span>
                    </button>
                    <pre id="dc-mongo-command">// MongoDB Shell Command
// Run this in MongoDB Compass or MongoDB Shell after connecting to your cluster

use cognito;

db.createCollection("comments");

// Create indexes for better performance
db.comments.createIndex({ "pageId": 1 });
db.comments.createIndex({ "chartHash": 1 });
db.comments.createIndex({ "author": 1 });
db.comments.createIndex({ "timestamp": -1 });

// Sample document structure (collection is created automatically on first insert)
// {
//   "id": "string (unique)",
//   "text": "string",
//   "link": "string",
//   "commentType": "string",
//   "type": "string (bubble|page)",
//   "timestamp": "string (ISO 8601)",
//   "author": "string",
//   "pageId": "string",
//   "parentId": "string|null",
//   "replies": [],
//   "chartHash": "string",
//   "chartLabel": "string",
//   "relativeX": "number",
//   "relativeY": "number",
//   "filterState": { "from": "string", "to": "string", "timezone": "string" },
//   "jiraTicket": { "key": "string", "url": "string" }
// }</pre>
                  </div>
                </li>
                <li>Enter your Data API URL, API Key, and Database Name below</li>
              </ol>
            </div>
            
            <div class="db-form-field">
              <label class="db-form-label">MongoDB Data API URL</label>
              <input 
                type="url" 
                id="dc-mongodb-url" 
                class="db-form-input" 
                placeholder="https://data.mongodb-api.com/app/data-xxxxx/endpoint/data/v1"
              >
            </div>
            
            <div class="db-form-field">
              <label class="db-form-label">MongoDB API Key</label>
              <div style="position: relative;">
                <input 
                  type="password" 
                  id="dc-mongodb-key" 
                  class="db-form-input" 
                  placeholder="Your MongoDB Data API Key"
                  style="padding-right: 2.5rem;"
                >
                <button type="button" class="dc-toggle-password" id="dc-toggle-mongodb-key" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; color: #6B7280; transition: color 0.2s;" title="Show/Hide API Key">
                  <svg id="dc-eye-icon-mongodb-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <svg id="dc-eye-off-icon-mongodb-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                </button>
              </div>
            </div>
            
            <div class="db-form-field">
              <label class="db-form-label">Database Name</label>
              <input 
                type="text" 
                id="dc-mongodb-database" 
                class="db-form-input" 
                placeholder="cognito"
                value="cognito"
              >
            </div>
            
            <div id="dc-db-loader" style="display: none; margin-top: 0.75rem; padding: 0.75rem; background: #F3F4F6; border-radius: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div class="dc-loading-spinner" style="width: 16px; height: 16px; border: 2px solid #E5E7EB; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                  <span style="font-size: 12px; color: #6B7280; font-weight: 500;">Testing connection...</span>
                </div>
                <button type="button" class="dc-copy-logs-btn" id="dc-copy-db-logs-btn-mongo" style="display: none; background: white; border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 11px; color: #6B7280; transition: all 0.2s; display: flex; align-items: center; gap: 0.25rem;" title="Copy logs">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="dc-copy-logs-text">Copy</span>
                </button>
              </div>
              <div id="dc-db-logs" style="font-size: 11px; color: #6B7280; line-height: 1.5; max-height: 120px; overflow-y: auto; font-family: 'Monaco', 'Courier New', monospace; background: white; padding: 0.5rem; border-radius: 4px; border: 1px solid #E5E7EB; white-space: pre-wrap; word-wrap: break-word; text-align: left; direction: ltr;"></div>
            </div>
            <p id="dc-db-error" style="color: #EF4444; font-size: 11px; margin-top: 0.5rem; display: none;"></p>
            <p id="dc-db-success" style="color: #10B981; font-size: 11px; margin-top: 0.5rem; display: none;">✅ Connection successful!</p>
          </div>
          
        </div>
        <div class="dc-dialog-footer" style="display: flex; gap: 0.5rem; padding: 0.75rem 1.25rem; border-top: 1px solid #F3F4F6;">
          <button class="dc-btn dc-btn-secondary" id="dc-db-cancel" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            Cancel
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-db-test" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            🔍 Test
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-db-save" style="flex: 1; padding: 0.5rem; font-size: 13px;" disabled>
            Save
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Copy SQL command button handler
    const copySqlBtn = dialog.querySelector('#dc-copy-sql-btn');
    if (copySqlBtn) {
      copySqlBtn.addEventListener('click', async () => {
        const sqlCommand = dialog.querySelector('#dc-sql-command');
        if (sqlCommand) {
          const sqlText = sqlCommand.textContent || sqlCommand.innerText;
          try {
            await navigator.clipboard.writeText(sqlText);
            const copyText = copySqlBtn.querySelector('.dc-copy-text');
            const originalText = copyText.textContent;
            copyText.textContent = 'Copied!';
            copySqlBtn.style.background = '#10B981';
            copySqlBtn.style.color = 'white';
            copySqlBtn.style.borderColor = '#10B981';
            
            setTimeout(() => {
              copyText.textContent = originalText;
              copySqlBtn.style.background = 'rgba(255, 255, 255, 0.9)';
              copySqlBtn.style.color = '#6B7280';
              copySqlBtn.style.borderColor = '#E5E7EB';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy SQL command:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = sqlText;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
              const copyText = copySqlBtn.querySelector('.dc-copy-text');
              const originalText = copyText.textContent;
              copyText.textContent = 'Copied!';
              copySqlBtn.style.background = '#10B981';
              copySqlBtn.style.color = 'white';
              copySqlBtn.style.borderColor = '#10B981';
              
              setTimeout(() => {
                copyText.textContent = originalText;
                copySqlBtn.style.background = 'rgba(255, 255, 255, 0.9)';
                copySqlBtn.style.color = '#6B7280';
                copySqlBtn.style.borderColor = '#E5E7EB';
              }, 2000);
            } catch (fallbackErr) {
              console.error('Fallback copy failed:', fallbackErr);
              alert('Failed to copy. Please select and copy manually.');
            }
            document.body.removeChild(textArea);
          }
        }
      });
    }
    
    // Copy MongoDB command button handler
    const copyMongoBtn = dialog.querySelector('#dc-copy-mongo-btn');
    if (copyMongoBtn) {
      copyMongoBtn.addEventListener('click', async () => {
        const mongoCommand = dialog.querySelector('#dc-mongo-command');
        if (mongoCommand) {
          const mongoText = mongoCommand.textContent || mongoCommand.innerText;
          try {
            await navigator.clipboard.writeText(mongoText);
            const copyText = copyMongoBtn.querySelector('.dc-copy-text');
            const originalText = copyText.textContent;
            copyText.textContent = 'Copied!';
            copyMongoBtn.style.background = '#10B981';
            copyMongoBtn.style.color = 'white';
            copyMongoBtn.style.borderColor = '#10B981';
            
            setTimeout(() => {
              copyText.textContent = originalText;
              copyMongoBtn.style.background = 'rgba(255, 255, 255, 0.9)';
              copyMongoBtn.style.color = '#6B7280';
              copyMongoBtn.style.borderColor = '#E5E7EB';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy MongoDB command:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = mongoText;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
              const copyText = copyMongoBtn.querySelector('.dc-copy-text');
              const originalText = copyText.textContent;
              copyText.textContent = 'Copied!';
              copyMongoBtn.style.background = '#10B981';
              copyMongoBtn.style.color = 'white';
              copyMongoBtn.style.borderColor = '#10B981';
              
              setTimeout(() => {
                copyText.textContent = originalText;
                copyMongoBtn.style.background = 'rgba(255, 255, 255, 0.9)';
                copyMongoBtn.style.color = '#6B7280';
                copyMongoBtn.style.borderColor = '#E5E7EB';
              }, 2000);
            } catch (fallbackErr) {
              console.error('Fallback copy failed:', fallbackErr);
              alert('Failed to copy. Please select and copy manually.');
            }
            document.body.removeChild(textArea);
          }
        }
      });
    }
    
    // Password toggle handlers for database dialog
    const setupPasswordToggle = (toggleBtnId, inputId, eyeIconId, eyeOffIconId) => {
      const toggleBtn = dialog.querySelector(toggleBtnId);
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          const input = dialog.querySelector(inputId);
          const eyeIcon = dialog.querySelector(eyeIconId);
          const eyeOffIcon = dialog.querySelector(eyeOffIconId);
          
          if (input && eyeIcon && eyeOffIcon) {
            if (input.type === 'password') {
              input.type = 'text';
              eyeIcon.style.display = 'none';
              eyeOffIcon.style.display = 'block';
            } else {
              input.type = 'password';
              eyeIcon.style.display = 'block';
              eyeOffIcon.style.display = 'none';
            }
          }
        });
      }
    };
    
    // Setup password toggles for Supabase and MongoDB
    setupPasswordToggle('#dc-toggle-supabase-key', '#dc-supabase-key', '#dc-eye-icon-supabase-key', '#dc-eye-off-icon-supabase-key');
    setupPasswordToggle('#dc-toggle-mongodb-key', '#dc-mongodb-key', '#dc-eye-icon-mongodb-key', '#dc-eye-off-icon-mongodb-key');
    
    // Local Storage option click handler
    const localStorageOption = document.getElementById('dc-local-storage-option');
    localStorageOption.addEventListener('click', async () => {
      console.log('💾 User selected Local Storage (Solo Mode)');
      // Save the choice to prevent showing dialog again
      await chrome.storage.sync.set({ dbProvider: 'local' });
      dialog.remove();
      resolve();
    });
    
    // Provider selection handling
    const providerRadios = dialog.querySelectorAll('input[name="db-provider"]');
    const cancelBtn = document.getElementById('dc-db-cancel');
    const testBtn = document.getElementById('dc-db-test');
    const saveBtn = document.getElementById('dc-db-save');
    
    let selectedProvider = 'supabase'; // Default to Supabase
    let connectionValid = false;
    
    // Cancel button
    cancelBtn.addEventListener('click', async () => {
      console.log('User cancelled database configuration');
      // Save local storage as default to prevent showing dialog again
      await chrome.storage.sync.set({ dbProvider: 'local' });
      dialog.remove();
      resolve();
    });
    
    // Select Supabase by default and show its form
    const supabaseRadio = dialog.querySelector('input[value="supabase"]');
    supabaseRadio.checked = true;
    document.getElementById('form-supabase').style.display = 'block';
    
    // Focus on first input after a short delay to ensure dialog is rendered
    setTimeout(() => {
      document.getElementById('dc-supabase-url').focus();
    }, 100);
    
    // Handle provider selection
    providerRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        selectedProvider = radio.value;
        
        // Hide all forms
        document.getElementById('form-supabase').style.display = 'none';
        document.getElementById('form-mongodb').style.display = 'none';
        
        // Show selected form
        document.getElementById(`form-${selectedProvider}`).style.display = 'block';
        
        // Reset validation state
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = 'Test Connection';
        testBtn.style.background = '';
        testBtn.disabled = false;
        
        // Hide messages
        const errorMsgs = dialog.querySelectorAll('[id="dc-db-error"]');
        const successMsgs = dialog.querySelectorAll('[id="dc-db-success"]');
        errorMsgs.forEach(msg => msg.style.display = 'none');
        successMsgs.forEach(msg => msg.style.display = 'none');
        
        // Focus on first input
        if (selectedProvider === 'supabase') {
          document.getElementById('dc-supabase-url').focus();
        } else if (selectedProvider === 'mongodb') {
          document.getElementById('dc-mongodb-url').focus();
        }
      });
    });
    
    // Test connection
    testBtn.addEventListener('click', async () => {
      if (!selectedProvider) {
        alert('Please select a database provider first');
        return;
      }
      
      const errorMsg = dialog.querySelector(`#form-${selectedProvider} #dc-db-error`);
      const successMsg = dialog.querySelector(`#form-${selectedProvider} #dc-db-success`);
      const loader = dialog.querySelector(`#form-${selectedProvider} #dc-db-loader`);
      const logs = dialog.querySelector(`#form-${selectedProvider} #dc-db-logs`);
      
      let config = {};
      
      if (selectedProvider === 'supabase') {
        const url = document.getElementById('dc-supabase-url').value.trim();
        const key = document.getElementById('dc-supabase-key').value.trim();
        
        if (!url || !key) {
          errorMsg.textContent = 'Please enter both URL and API key';
          errorMsg.style.display = 'block';
          successMsg.style.display = 'none';
          return;
        }
        
        config = { supabaseUrl: url, supabaseKey: key };
      } else if (selectedProvider === 'mongodb') {
        const url = document.getElementById('dc-mongodb-url').value.trim();
        const key = document.getElementById('dc-mongodb-key').value.trim();
        const database = document.getElementById('dc-mongodb-database').value.trim();
        
        if (!url || !key || !database) {
          errorMsg.textContent = 'Please fill in all fields';
          errorMsg.style.display = 'block';
          successMsg.style.display = 'none';
          return;
        }
        
        config = { mongoUrl: url, mongoApiKey: key, mongoDatabase: database };
      }
      
      // Reset UI
      testBtn.textContent = '⏳ Testing...';
      testBtn.disabled = true;
      testBtn.style.background = '';
      errorMsg.style.display = 'none';
      successMsg.style.display = 'none';
      loader.style.display = 'block';
      logs.textContent = '';
      
      // Get copy button - different IDs for Supabase and MongoDB
      const copyBtn = dialog.querySelector(`#form-${selectedProvider} .dc-copy-logs-btn`);
      if (copyBtn) {
        copyBtn.style.display = 'none';
      }
      
      // Helper function to add log
      const addLog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '🔍';
        const logLine = `[${timestamp}] ${icon} ${message}`;
        
        // Append to textContent for easy copying
        if (logs.textContent) {
          logs.textContent += '\n' + logLine;
        } else {
          logs.textContent = logLine;
        }
        
        logs.scrollTop = logs.scrollHeight;
        
        // Show copy button when logs are present
        if (copyBtn && logs.textContent.trim()) {
          copyBtn.style.display = 'flex';
        }
      };
      
      // Copy button functionality
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            const logText = logs.textContent || '';
            if (!logText.trim()) {
              return;
            }
            
            await navigator.clipboard.writeText(logText);
            
            // Visual feedback
            const originalText = copyBtn.querySelector('.dc-copy-logs-text').textContent;
            copyBtn.querySelector('.dc-copy-logs-text').textContent = 'Copied!';
            copyBtn.style.background = '#10B981';
            copyBtn.style.borderColor = '#10B981';
            copyBtn.style.color = 'white';
            
            setTimeout(() => {
              copyBtn.querySelector('.dc-copy-logs-text').textContent = originalText;
              copyBtn.style.background = 'white';
              copyBtn.style.borderColor = '#E5E7EB';
              copyBtn.style.color = '#6B7280';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy logs:', err);
          }
        };
      }
      
      // Set up timeout (increased to 25 seconds to allow for network latency)
      const TIMEOUT_MS = 25000; // 25 seconds
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          addLog('Connection timeout - request may still be processing on server', 'error');
          reject(new Error('Connection timeout after 25 seconds. The request may have reached the server but the response took too long. Please check your network connection.'));
        }, TIMEOUT_MS);
      });
      
      try {
        addLog(`Starting ${selectedProvider === 'supabase' ? 'Supabase' : 'MongoDB'} connection test...`);
        addLog(`Connecting to: ${selectedProvider === 'supabase' ? config.supabaseUrl : config.mongoUrl}`);
        
        // Race between timeout and connection test
        const testPromise = db.testConnection(selectedProvider, config, addLog);
        const isValid = await Promise.race([testPromise, timeoutPromise]);
        
        clearTimeout(timeoutId);
        
        console.log('🔍 Database test result:', isValid);
        
        if (isValid) {
          addLog('Connection successful!', 'success');
          loader.style.display = 'none'; // Stop loader immediately on success
          successMsg.textContent = '✅ Database connection successful!';
          successMsg.style.display = 'block';
          errorMsg.style.display = 'none';
          connectionValid = true;
          saveBtn.disabled = false;
          testBtn.textContent = '✅ Connected';
          testBtn.style.background = '#10B981';
          testBtn.disabled = false;
        } else {
          addLog('Connection failed. Please check your credentials.', 'error');
          loader.style.display = 'none'; // Stop loader immediately on failure
          errorMsg.textContent = '❌ Connection failed. Please check your credentials and try again.';
          errorMsg.style.display = 'block';
          successMsg.style.display = 'none';
          connectionValid = false;
          saveBtn.disabled = true;
          testBtn.textContent = '🔍 Test Connection';
          testBtn.style.background = '';
          testBtn.disabled = false;
        }
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('🔍 Database test error:', error);
        addLog(`Error: ${error.message}`, 'error');
        loader.style.display = 'none'; // Stop loader immediately on error/timeout
        errorMsg.textContent = `❌ Connection failed: ${error.message || 'Unknown error'}`;
        errorMsg.style.display = 'block';
        successMsg.style.display = 'none';
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = '🔍 Test Connection';
        testBtn.style.background = '';
        testBtn.disabled = false;
      }
    });
    
    // Save configuration
    saveBtn.addEventListener('click', async () => {
      if (!connectionValid) {
        alert('Please test connection first');
        return;
      }
      
      let config = { dbProvider: selectedProvider };
      
      if (selectedProvider === 'supabase') {
        config.supabaseUrl = document.getElementById('dc-supabase-url').value.trim();
        config.supabaseKey = document.getElementById('dc-supabase-key').value.trim();
      } else if (selectedProvider === 'mongodb') {
        config.mongoUrl = document.getElementById('dc-mongodb-url').value.trim();
        config.mongoApiKey = document.getElementById('dc-mongodb-key').value.trim();
        config.mongoDatabase = document.getElementById('dc-mongodb-database').value.trim();
      }
      
      await chrome.storage.sync.set(config);
      
      // Reinitialize database
      await db.init();
      
      console.log('✅ Database configuration saved');
      showToast(`Database configured with ${selectedProvider === 'supabase' ? 'Supabase' : 'MongoDB'}!`);
      dialog.remove();
      resolve();
    });
  });
}

// Show Jira configuration dialog
function showJiraConfigDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dc-dialog-overlay';
    dialog.style.zIndex = '10000000';
    
    dialog.innerHTML = `
      <div class="dc-dialog" style="max-width: 550px; max-height: 80vh; display: flex; flex-direction: column;">
        <div class="dc-dialog-header" style="padding: 1rem 1.25rem 0.75rem;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #1F2937; display: flex; align-items: center; gap: 0.5rem;">
            <img src="${chrome.runtime.getURL('icons/atlassian.png')}" alt="Atlassian" style="width: 20px; height: 20px;">
            Atlassian Integration
          </h3>
          <p style="margin: 0.5rem 0 0; color: #6B7280; font-size: 12px; line-height: 1.4;">
            Connect your Jira account to create and attach tickets
          </p>
        </div>
        <div class="dc-dialog-body" style="padding: 0 1.25rem; max-height: calc(80vh - 140px); overflow-y: auto;">
          <div class="dc-form-group">
            <label class="dc-form-label">Jira URL</label>
            <input 
              type="url" 
              id="dc-jira-url" 
              class="dc-form-input" 
              placeholder="https://yourcompany.atlassian.net"
              value="${jira.jiraUrl || ''}"
            >
          </div>
          
          <div class="dc-form-group">
            <label class="dc-form-label">Email</label>
            <input 
              type="email" 
              id="dc-jira-email" 
              class="dc-form-input" 
              placeholder="your.email@company.com"
              value="${jira.jiraEmail || ''}"
            >
          </div>
          
          <div class="dc-form-group">
            <label class="dc-form-label">
              API Token 
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" style="font-size: 11px; color: #3B82F6; text-decoration: none;">Get Token</a>
            </label>
            <div style="position: relative;">
              <input 
                type="password" 
                id="dc-jira-token" 
                class="dc-form-input" 
                placeholder="Your Jira API Token"
                value="${jira.jiraApiToken || ''}"
                style="padding-right: 2.5rem;"
              >
              <button type="button" class="dc-toggle-password" id="dc-toggle-jira-token" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; color: #6B7280; transition: color 0.2s;" title="Show/Hide API Token">
                <svg id="dc-eye-icon-jira-token" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg id="dc-eye-off-icon-jira-token" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="dc-info-box" style="background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 8px; padding: 0.75rem; margin-top: 0.75rem; font-size: 11px; line-height: 1.4;">
            <div style="display: flex; align-items: center; margin-bottom: 0.25rem;">
              <span style="font-size: 12px; margin-right: 0.25rem;">💡</span>
              <strong style="font-size: 12px; color: #0369A1;">Setup Steps:</strong>
            </div>
            <div style="color: #0369A1; margin-left: 1rem;">
              1. Go to your Jira instance<br>
              2. Click your profile → Account settings<br>
              3. Security → API tokens → Create token<br>
              4. Copy token and paste above
            </div>
          </div>
          
          <div id="dc-jira-loader" style="display: none; margin-top: 0.75rem; padding: 0.75rem; background: #F3F4F6; border-radius: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="dc-loading-spinner" style="width: 16px; height: 16px; border: 2px solid #E5E7EB; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span style="font-size: 12px; color: #6B7280; font-weight: 500;">Testing connection...</span>
              </div>
              <button type="button" class="dc-copy-logs-btn" id="dc-copy-jira-logs-btn" style="display: none; background: white; border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 11px; color: #6B7280; transition: all 0.2s; display: flex; align-items: center; gap: 0.25rem;" title="Copy logs">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="dc-copy-logs-text">Copy</span>
              </button>
            </div>
            <div id="dc-jira-logs" style="font-size: 11px; color: #6B7280; line-height: 1.5; max-height: 120px; overflow-y: auto; font-family: 'Monaco', 'Courier New', monospace; background: white; padding: 0.5rem; border-radius: 4px; border: 1px solid #E5E7EB; white-space: pre-wrap; word-wrap: break-word; text-align: left; direction: ltr;"></div>
          </div>
          <p id="dc-jira-error" style="color: #EF4444; font-size: 11px; margin-top: 0.75rem; display: none;"></p>
          <p id="dc-jira-success" style="color: #10B981; font-size: 11px; margin-top: 0.75rem; display: none;">✅ Connection successful!</p>
        </div>
        <div class="dc-dialog-footer" style="padding: 0.75rem 1.25rem 1rem; display: flex; gap: 0.5rem; border-top: 1px solid #F3F4F6;">
          <button class="dc-btn dc-btn-secondary" id="dc-jira-close" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            Cancel
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-jira-test" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            🔍 Test
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-jira-save" style="flex: 1; padding: 0.5rem; font-size: 13px;" disabled>
            Save
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Password toggle handler for JIRA token
    const jiraToggleBtn = dialog.querySelector('#dc-toggle-jira-token');
    if (jiraToggleBtn) {
      jiraToggleBtn.addEventListener('click', () => {
        const tokenInput = document.getElementById('dc-jira-token');
        const eyeIcon = dialog.querySelector('#dc-eye-icon-jira-token');
        const eyeOffIcon = dialog.querySelector('#dc-eye-off-icon-jira-token');
        
        if (tokenInput && eyeIcon && eyeOffIcon) {
          if (tokenInput.type === 'password') {
            tokenInput.type = 'text';
            eyeIcon.style.display = 'none';
            eyeOffIcon.style.display = 'block';
          } else {
            tokenInput.type = 'password';
            eyeIcon.style.display = 'block';
            eyeOffIcon.style.display = 'none';
          }
        }
      });
    }
    
    const urlInput = document.getElementById('dc-jira-url');
    const emailInput = document.getElementById('dc-jira-email');
    const tokenInput = document.getElementById('dc-jira-token');
    const errorMsg = document.getElementById('dc-jira-error');
    const successMsg = document.getElementById('dc-jira-success');
    const closeBtn = document.getElementById('dc-jira-close');
    const testBtn = document.getElementById('dc-jira-test');
    const saveBtn = document.getElementById('dc-jira-save');
    
    let connectionValid = false;
    
    if (jira.isConfigured) {
      connectionValid = true;
      saveBtn.disabled = false;
    }
    
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      resolve();
    });
    
    testBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim().replace(/\/$/, ''); // Remove trailing slash
      const email = emailInput.value.trim();
      const token = tokenInput.value.trim();
      
      if (!url || !email || !token) {
        errorMsg.textContent = 'Please fill all fields';
        errorMsg.style.display = 'block';
        successMsg.style.display = 'none';
        return;
      }
      
      const loader = document.getElementById('dc-jira-loader');
      const logs = document.getElementById('dc-jira-logs');
      const copyBtn = document.getElementById('dc-copy-jira-logs-btn');
      
      // Reset UI
      testBtn.textContent = '⏳ Testing...';
      testBtn.disabled = true;
      testBtn.style.background = '';
      errorMsg.style.display = 'none';
      successMsg.style.display = 'none';
      loader.style.display = 'block';
      logs.textContent = '';
      
      if (copyBtn) {
        copyBtn.style.display = 'none';
      }
      
      // Add log helper
      const addLog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '🔍';
        const logLine = `[${timestamp}] ${prefix} ${message}`;
        
        // Append to textContent for easy copying
        if (logs.textContent) {
          logs.textContent += '\n' + logLine;
        } else {
          logs.textContent = logLine;
        }
        
        logs.scrollTop = logs.scrollHeight;
        console.log(`[JIRA-TEST] ${message}`);
        
        // Show copy button when logs are present
        if (copyBtn && logs.textContent.trim()) {
          copyBtn.style.display = 'flex';
        }
      };
      
      // Copy button functionality
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            const logText = logs.textContent || '';
            if (!logText.trim()) {
              return;
            }
            
            await navigator.clipboard.writeText(logText);
            
            // Visual feedback
            const originalText = copyBtn.querySelector('.dc-copy-logs-text').textContent;
            copyBtn.querySelector('.dc-copy-logs-text').textContent = 'Copied!';
            copyBtn.style.background = '#10B981';
            copyBtn.style.borderColor = '#10B981';
            copyBtn.style.color = 'white';
            
            setTimeout(() => {
              copyBtn.querySelector('.dc-copy-logs-text').textContent = originalText;
              copyBtn.style.background = 'white';
              copyBtn.style.borderColor = '#E5E7EB';
              copyBtn.style.color = '#6B7280';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy logs:', err);
          }
        };
      }
      
      addLog('Starting Jira connection test...');
      addLog(`Jira URL: ${url}`);
      addLog(`Email: ${email}`);
      addLog(`API Token: ${token.substring(0, 10)}...`);
      
      // Temporarily set credentials for testing
      jira.jiraUrl = url;
      jira.jiraEmail = email;
      jira.jiraApiToken = token;
      
      try {
        const result = await jira.testConnection(addLog);
        console.log('🔍 Jira test result:', result);
        
        if (result.success) {
          addLog(`Connection successful! User: ${result.user}`, 'success');
          loader.style.display = 'none'; // Stop loader on success
          successMsg.textContent = `✅ Connected as ${result.user}`;
          successMsg.style.display = 'block';
          errorMsg.style.display = 'none';
          connectionValid = true;
          saveBtn.disabled = false;
          testBtn.textContent = '✅ Connected';
          testBtn.style.background = '#10B981';
          testBtn.disabled = false;
        } else {
          addLog(`Connection failed: ${result.error}`, 'error');
          loader.style.display = 'none'; // Stop loader on failure
          errorMsg.textContent = `❌ ${result.error}`;
          errorMsg.style.display = 'block';
          successMsg.style.display = 'none';
          connectionValid = false;
          saveBtn.disabled = true;
          testBtn.textContent = '🔍 Test';
          testBtn.style.background = '';
          testBtn.disabled = false;
        }
      } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
        console.error('🔍 Jira test error:', error);
        loader.style.display = 'none'; // Stop loader on error
        errorMsg.textContent = `❌ Connection failed: ${error.message}`;
        errorMsg.style.display = 'block';
        successMsg.style.display = 'none';
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = '🔍 Test';
        testBtn.style.background = '';
        testBtn.disabled = false;
      } finally {
        // Keep loader visible to show logs
        setTimeout(() => {
          // Optionally hide loader after a delay, or keep it visible
        }, 100);
      }
    });
    
    saveBtn.addEventListener('click', async () => {
      if (!connectionValid) {
        errorMsg.textContent = 'Please test connection first';
        errorMsg.style.display = 'block';
        return;
      }
      
      const url = urlInput.value.trim().replace(/\/$/, '');
      const email = emailInput.value.trim();
      const token = tokenInput.value.trim();
      
      await chrome.storage.sync.set({ 
        jiraUrl: url, 
        jiraEmail: email,
        jiraApiToken: token
      });
      
      jira.jiraUrl = url;
      jira.jiraEmail = email;
      jira.jiraApiToken = token;
      jira.isConfigured = true;
      
      showToast('✅ Jira configuration saved!');
      dialog.remove();
      resolve();
    });
    
    [urlInput, emailInput, tokenInput].forEach(input => {
      input.addEventListener('input', () => {
        errorMsg.style.display = 'none';
        successMsg.style.display = 'none';
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = '🔍 Test Connection';
        testBtn.disabled = false;
        testBtn.style.background = '';
      });
    });
  });
}

// Show AI configuration dialog
function showAIConfigDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dc-dialog-overlay';
    dialog.style.zIndex = '10000000';
    
    dialog.innerHTML = `
      <div class="dc-dialog" style="max-width: 550px; max-height: 80vh; display: flex; flex-direction: column;">
        <div class="dc-dialog-header" style="padding: 1rem 1.25rem 0.75rem;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #1F2937;">🤖 AI Configuration</h3>
          <p style="margin: 0.5rem 0 0; color: #6B7280; font-size: 12px; line-height: 1.4;">
            Enable AI-powered chart analysis and insights
          </p>
        </div>
        <div class="dc-dialog-body" style="padding: 0 1.25rem; max-height: calc(80vh - 140px); overflow-y: auto;">
          <div class="dc-form-group">
            <label class="dc-form-label">AI Provider</label>
    <select id="dc-ai-provider" class="dc-form-input">
      <option value="">Select Provider</option>
      <option value="openai" ${ai.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
      <option value="anthropic" ${ai.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
      <option value="gemini" ${ai.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
    </select>
          </div>
          
          <div class="dc-form-group" id="dc-model-selection" style="display: none;">
            <label class="dc-form-label">Model Version</label>
            <select id="dc-ai-model" class="dc-form-input">
              <option value="">Select Model</option>
            </select>
          </div>
          
          <div class="dc-form-group">
            <label class="dc-form-label">API Key</label>
            <div style="position: relative;">
              <input 
                type="password" 
                id="dc-ai-key" 
                class="dc-form-input" 
                placeholder="Enter your API key"
                value="${ai.apiKey || ''}"
                style="padding-right: 2.5rem;"
              >
              <button type="button" class="dc-toggle-password" id="dc-toggle-ai-key" style="position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; color: #6B7280; transition: color 0.2s;" title="Show/Hide API Key">
                <svg id="dc-eye-icon-ai-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg id="dc-eye-off-icon-ai-key" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="dc-info-box" style="background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 8px; padding: 0.75rem; margin-top: 0.75rem; font-size: 11px; line-height: 1.4;">
            <div style="display: flex; align-items: center; margin-bottom: 0.25rem;">
              <span style="font-size: 12px; margin-right: 0.25rem;">💡</span>
              <strong style="font-size: 12px; color: #0369A1;">Get API Keys:</strong>
            </div>
            <div style="color: #0369A1; margin-left: 1rem;">
              • <a href="https://platform.openai.com/api-keys" target="_blank" style="color: #0369A1; text-decoration: none;">OpenAI</a> - GPT-5, GPT-4, GPT-4-turbo<br>
              • <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color: #0369A1; text-decoration: none;">Anthropic</a> - Claude 4.5, 4.0, 3.5 Sonnet<br>
              • <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #0369A1; text-decoration: none;">Google AI Studio</a> - Gemini 2.0 Flash, 1.5 Flash
            </div>
          </div>
          
          <div class="dc-info-box" style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 0.75rem; margin-top: 0.5rem; font-size: 11px; line-height: 1.4;">
            <div style="display: flex; align-items: center; margin-bottom: 0.25rem;">
              <span style="font-size: 12px; margin-right: 0.25rem;">✨</span>
              <strong style="font-size: 12px; color: #166534;">AI Features:</strong>
            </div>
            <div style="color: #166534; margin-left: 1rem;">
              • Analyze chart data and trends<br>
              • Generate actionable insights<br>
              • Identify anomalies and patterns<br>
              • Provide recommendations
            </div>
          </div>
          
          <div id="dc-ai-loader" style="display: none; margin-top: 0.75rem; padding: 0.75rem; background: #F3F4F6; border-radius: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="dc-loading-spinner" style="width: 16px; height: 16px; border: 2px solid #E5E7EB; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span style="font-size: 12px; color: #6B7280; font-weight: 500;">Testing connection...</span>
              </div>
              <button type="button" class="dc-copy-logs-btn" id="dc-copy-ai-logs-btn" style="display: none; background: white; border: 1px solid #E5E7EB; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 11px; color: #6B7280; transition: all 0.2s; display: flex; align-items: center; gap: 0.25rem;" title="Copy logs">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="dc-copy-logs-text">Copy</span>
              </button>
            </div>
            <div id="dc-ai-logs" style="font-size: 11px; color: #6B7280; line-height: 1.5; max-height: 120px; overflow-y: auto; font-family: 'Monaco', 'Courier New', monospace; background: white; padding: 0.5rem; border-radius: 4px; border: 1px solid #E5E7EB; white-space: pre-wrap; word-wrap: break-word; text-align: left; direction: ltr;"></div>
          </div>
          <p id="dc-ai-error" style="color: #EF4444; font-size: 11px; margin-top: 0.75rem; display: none;"></p>
          <p id="dc-ai-success" style="color: #10B981; font-size: 11px; margin-top: 0.75rem; display: none;">✅ Connection successful!</p>
        </div>
        <div class="dc-dialog-footer" style="padding: 0.75rem 1.25rem 1rem; display: flex; gap: 0.5rem; border-top: 1px solid #F3F4F6;">
          <button class="dc-btn dc-btn-secondary" id="dc-ai-close" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            Cancel
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-ai-test" style="flex: 1; padding: 0.5rem; font-size: 13px;">
            🔍 Test
          </button>
          <button class="dc-btn dc-btn-primary" id="dc-ai-save" style="flex: 1; padding: 0.5rem; font-size: 13px;" disabled>
            Save
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Password toggle handler for AI API key
    const aiToggleBtn = dialog.querySelector('#dc-toggle-ai-key');
    if (aiToggleBtn) {
      aiToggleBtn.addEventListener('click', () => {
        const keyInput = document.getElementById('dc-ai-key');
        const eyeIcon = dialog.querySelector('#dc-eye-icon-ai-key');
        const eyeOffIcon = dialog.querySelector('#dc-eye-off-icon-ai-key');
        
        if (keyInput && eyeIcon && eyeOffIcon) {
          if (keyInput.type === 'password') {
            keyInput.type = 'text';
            eyeIcon.style.display = 'none';
            eyeOffIcon.style.display = 'block';
          } else {
            keyInput.type = 'password';
            eyeIcon.style.display = 'block';
            eyeOffIcon.style.display = 'none';
          }
        }
      });
    }
    
    const providerSelect = document.getElementById('dc-ai-provider');
    const modelSelect = document.getElementById('dc-ai-model');
    const modelSelection = document.getElementById('dc-model-selection');
    const keyInput = document.getElementById('dc-ai-key');
    const errorMsg = document.getElementById('dc-ai-error');
    const successMsg = document.getElementById('dc-ai-success');
    const closeBtn = document.getElementById('dc-ai-close');
    const testBtn = document.getElementById('dc-ai-test');
    const saveBtn = document.getElementById('dc-ai-save');
    
    let connectionValid = false;
    
    // Model options for each provider
    const modelOptions = {
      'openai': [
        { value: 'gpt-5', text: 'GPT-5 (Latest)' },
        { value: 'gpt-4', text: 'GPT-4' },
        { value: 'gpt-4-turbo', text: 'GPT-4 Turbo' }
      ],
      'anthropic': [
        { value: 'claude-4-5-sonnet-20241022', text: 'Claude 4.5 Sonnet (Latest)' },
        { value: 'claude-3-5-sonnet-20241022', text: 'Claude 3.5 Sonnet' },
        { value: 'claude-3-5-haiku-20241022', text: 'Claude 3.5 Haiku' }
      ],
      'gemini': [
        { value: 'gemini-2.0-flash', text: 'Gemini 2.0 Flash (Latest)' },
        { value: 'gemini-1.5-flash', text: 'Gemini 1.5 Flash' }
      ]
    };

    // Simple function to ensure select displays its value
    const updateSelectDisplay = (selectElement) => {
      if (!selectElement) return;
      
      const value = selectElement.value;
      if (value) {
        // Find and set the correct option as selected
        const optionIndex = Array.from(selectElement.options).findIndex(opt => opt.value === value);
        if (optionIndex >= 0) {
          selectElement.selectedIndex = optionIndex;
          // Ensure the option is marked as selected
          selectElement.options[optionIndex].selected = true;
        }
        // Force style update - use darker color for visibility
        selectElement.style.color = '#1F2937';
        selectElement.style.fontWeight = '500';
        // Force browser reflow
        void selectElement.offsetWidth;
      } else {
        selectElement.style.color = '#9CA3AF';
        selectElement.style.fontWeight = '400';
      }
    };
    
    // Handle provider selection
    providerSelect.addEventListener('change', (e) => {
      const selectedProvider = providerSelect.value;
      
      // Force the display to update immediately
      if (selectedProvider) {
        providerSelect.selectedIndex = Array.from(providerSelect.options).findIndex(opt => opt.value === selectedProvider);
        providerSelect.style.color = '#1F2937';
        providerSelect.style.fontWeight = '500';
      }
      
      // Clear and reset model select
      modelSelect.innerHTML = '<option value="">Select Model</option>';
      modelSelect.value = '';
      modelSelect.style.color = '#9CA3AF';
      
      if (selectedProvider && modelOptions[selectedProvider]) {
        modelSelection.style.display = 'block';
        modelOptions[selectedProvider].forEach(model => {
          const option = document.createElement('option');
          option.value = model.value;
          option.textContent = model.text;
          modelSelect.appendChild(option);
        });
      } else {
        modelSelection.style.display = 'none';
      }
    });
    
    // Ensure selected values are visible when model dropdown changes
    modelSelect.addEventListener('change', (e) => {
      const selectedModel = modelSelect.value;
      if (selectedModel) {
        modelSelect.selectedIndex = Array.from(modelSelect.options).findIndex(opt => opt.value === selectedModel);
        modelSelect.style.color = '#1F2937';
        modelSelect.style.fontWeight = '500';
      }
    });
    
    // Initialize display for selects - ensure values are visible
    const initSelects = () => {
      if (providerSelect && providerSelect.value) {
        updateSelectDisplay(providerSelect);
      }
      if (modelSelect && modelSelect.value) {
        updateSelectDisplay(modelSelect);
      }
    };
    
    // Call immediately and after a short delay
    initSelects();
    setTimeout(initSelects, 50);
    setTimeout(initSelects, 100);

    // Initialize with current provider if configured
    if (ai.isConfigured) {
      connectionValid = true;
      saveBtn.disabled = false;
      if (ai.provider && modelOptions[ai.provider]) {
        // Set provider select value and force display
        providerSelect.value = ai.provider;
        const providerIndex = Array.from(providerSelect.options).findIndex(opt => opt.value === ai.provider);
        if (providerIndex >= 0) {
          providerSelect.selectedIndex = providerIndex;
          providerSelect.style.color = '#1F2937';
          providerSelect.style.fontWeight = '500';
        }
        
        modelSelection.style.display = 'block';
        modelOptions[ai.provider].forEach(model => {
          const option = document.createElement('option');
          option.value = model.value;
          option.textContent = model.text;
          modelSelect.appendChild(option);
        });
        
        // Set model select value and force display
        if (ai.model) {
          modelSelect.value = ai.model;
          const modelIndex = Array.from(modelSelect.options).findIndex(opt => opt.value === ai.model);
          if (modelIndex >= 0) {
            modelSelect.selectedIndex = modelIndex;
            modelSelect.style.color = '#1F2937';
            modelSelect.style.fontWeight = '500';
          }
        }
      }
    }
    
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      resolve();
    });
    
    testBtn.addEventListener('click', async () => {
      const provider = providerSelect.value;
      const model = modelSelect.value;
      const key = keyInput.value.trim();
      
      if (!provider || !model || !key) {
        errorMsg.textContent = 'Please select provider, model, and enter API key';
        errorMsg.style.display = 'block';
        successMsg.style.display = 'none';
        return;
      }
      
      const loader = document.getElementById('dc-ai-loader');
      const logs = document.getElementById('dc-ai-logs');
      const copyBtn = document.getElementById('dc-copy-ai-logs-btn');
      
      // Reset UI
      testBtn.textContent = '⏳ Testing...';
      testBtn.disabled = true;
      testBtn.style.background = '';
      errorMsg.style.display = 'none';
      successMsg.style.display = 'none';
      loader.style.display = 'block';
      logs.textContent = '';
      
      if (copyBtn) {
        copyBtn.style.display = 'none';
      }
      
      // Add log helper
      const addLog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '🔍';
        const logLine = `[${timestamp}] ${prefix} ${message}`;
        
        // Append to textContent for easy copying
        if (logs.textContent) {
          logs.textContent += '\n' + logLine;
        } else {
          logs.textContent = logLine;
        }
        
        logs.scrollTop = logs.scrollHeight;
        console.log(`[AI-TEST] ${message}`);
        
        // Show copy button when logs are present
        if (copyBtn && logs.textContent.trim()) {
          copyBtn.style.display = 'flex';
        }
      };
      
      // Copy button functionality
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            const logText = logs.textContent || '';
            if (!logText.trim()) {
              return;
            }
            
            await navigator.clipboard.writeText(logText);
            
            // Visual feedback
            const originalText = copyBtn.querySelector('.dc-copy-logs-text').textContent;
            copyBtn.querySelector('.dc-copy-logs-text').textContent = 'Copied!';
            copyBtn.style.background = '#10B981';
            copyBtn.style.borderColor = '#10B981';
            copyBtn.style.color = 'white';
            
            setTimeout(() => {
              copyBtn.querySelector('.dc-copy-logs-text').textContent = originalText;
              copyBtn.style.background = 'white';
              copyBtn.style.borderColor = '#E5E7EB';
              copyBtn.style.color = '#6B7280';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy logs:', err);
          }
        };
      }
      
      addLog(`Starting ${provider.toUpperCase()} connection test...`);
      addLog(`Provider: ${provider}`);
      addLog(`Model: ${model}`);
      addLog(`API Key: ${key.substring(0, 10)}...`);
      
      // Temporarily set for testing
      ai.provider = provider;
      ai.model = model;
      ai.apiKey = key;
      
      try {
        const isValid = await ai.testConnection(addLog);
        
        if (isValid) {
          const modelText = modelOptions[provider].find(m => m.value === model)?.text || model;
          addLog(`Connection successful!`, 'success');
          loader.style.display = 'none'; // Stop loader on success
          successMsg.textContent = `✅ ${provider.charAt(0).toUpperCase() + provider.slice(1)} (${modelText}) connected successfully!`;
          successMsg.style.display = 'block';
          errorMsg.style.display = 'none';
          connectionValid = true;
          saveBtn.disabled = false;
          testBtn.textContent = '✅ Connected';
          testBtn.style.background = '#10B981';
          testBtn.disabled = false;
        } else {
          addLog(`Connection failed. Check your API key.`, 'error');
          loader.style.display = 'none'; // Stop loader on failure
          errorMsg.textContent = '❌ Connection failed. Check your API key.';
          errorMsg.style.display = 'block';
          successMsg.style.display = 'none';
          connectionValid = false;
          saveBtn.disabled = true;
          testBtn.textContent = '🔍 Test';
          testBtn.style.background = '';
          testBtn.disabled = false;
        }
      } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
        loader.style.display = 'none'; // Stop loader on error
        errorMsg.textContent = `❌ Error: ${error.message}`;
        errorMsg.style.display = 'block';
        successMsg.style.display = 'none';
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = '🔍 Test';
        testBtn.style.background = '';
        testBtn.disabled = false;
      }
    });
    
    saveBtn.addEventListener('click', async () => {
      if (!connectionValid) {
        errorMsg.textContent = 'Please test connection first';
        errorMsg.style.display = 'block';
        return;
      }
      
      const provider = providerSelect.value;
      const model = modelSelect.value;
      const key = keyInput.value.trim();
      
      await chrome.storage.sync.set({ 
        aiProvider: provider,
        aiModel: model,
        aiApiKey: key
      });
      
      ai.provider = provider;
      ai.model = model;
      ai.apiKey = key;
      ai.isConfigured = true;
      
      showToast('✅ AI configuration saved!');
      dialog.remove();
      resolve();
    });
    
    [providerSelect, modelSelect, keyInput].forEach(input => {
      input.addEventListener('input', () => {
        errorMsg.style.display = 'none';
        successMsg.style.display = 'none';
        connectionValid = false;
        saveBtn.disabled = true;
        testBtn.textContent = '🔍 Test';
        testBtn.disabled = false;
        testBtn.style.background = '';
      });
    });
  });
}