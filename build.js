#!/usr/bin/env node

/**
 * Unified build script for Cognito AI Extension
 * Supports: clean, production, and Chrome Store builds
 * 
 * Usage:
 *   node build.js                    # Clean build (default)
 *   node build.js --production       # Production build (minified, no console.log)
 *   node build.js --chrome-store     # Chrome Store build (clean, optimized)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const isProduction = args.includes('--production');
const isChromeStore = args.includes('--chrome-store');
const mode = isChromeStore ? 'chrome-store' : (isProduction ? 'production' : 'clean');

console.log(`🔨 Building Cognito AI Extension (${mode} mode)...\n`);

// Files to copy (all modes)
const filesToCopy = [
  'manifest.json',
  'popup.html',
  'options.html',
  'styles.css',
  'html2canvas.min.js',
  'icons/',
  'generated-image-Photoroom.png'
];

// JavaScript files to process
const jsFiles = [
  'background.js',
  'content.js',
  'popup.js',
  'options.js',
  'integrations.js',
  'database.js'
];

// Simple minification (removes comments, extra whitespace)
function minify(code) {
  // Remove comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  code = code.replace(/\/\/.*$/gm, '');
  
  // Basic minification (preserve newlines for readability in clean mode)
  if (isProduction || isChromeStore) {
    code = code.replace(/\s+/g, ' ');
    code = code.replace(/\s*([{}();,=+\-*/])\s*/g, '$1');
  } else {
    // Just remove trailing whitespace
    code = code.replace(/[ \t]+$/gm, '');
  }
  
  return code;
}

// Production processing (removes console.log)
function processForProduction(code) {
  // Remove console statements
  code = code.replace(/console\.(log|debug|info)\([^)]*\);?/g, '');
  // Keep console.error and console.warn for debugging
  return code;
}

// Create build directory
const buildDir = path.join(__dirname, 'build');
if (fs.existsSync(buildDir)) {
  console.log('🧹 Cleaning build directory...');
  execSync(`rm -rf "${buildDir}"`);
}
fs.mkdirSync(buildDir, { recursive: true });

// Copy static files
console.log('\n📋 Copying static files...');
filesToCopy.forEach(file => {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(buildDir, file);
  
  if (fs.existsSync(srcPath)) {
    if (fs.statSync(srcPath).isDirectory()) {
      execSync(`cp -r "${srcPath}" "${destPath}"`);
    } else {
      // Ensure parent directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcPath, destPath);
    }
    console.log(`  ✅ ${file}`);
  } else {
    console.warn(`  ⚠️  ${file} not found, skipping`);
  }
});

// Process JavaScript files
console.log('\n📝 Processing JavaScript files...');
jsFiles.forEach(file => {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(buildDir, file);
  
  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠️  ${file} not found, skipping`);
    return;
  }
  
  let code = fs.readFileSync(srcPath, 'utf8');
  
  if (isProduction || isChromeStore) {
    // Minify and remove console.log for production/Chrome Store
    code = minify(code);
    if (isProduction) {
      code = processForProduction(code);
    }
    console.log(`  ✅ ${file} (minified)`);
  } else {
    // Clean mode: just copy as-is
    console.log(`  ✅ ${file} (clean)`);
  }
  
  // Ensure parent directory exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  fs.writeFileSync(destPath, code);
});

// Create distribution package
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Determine zip name based on mode
const zipName = isChromeStore 
  ? 'cognito-ai-extension-chrome-store.zip'
  : isProduction 
    ? 'cognito-ai-extension-production.zip'
    : 'cognito-ai-extension-clean.zip';

const zipPath = path.join(distDir, zipName);

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log('\n📦 Creating distribution package...');

// Create zip from build directory (manifest.json at root)
process.chdir(buildDir);
try {
  execSync(`zip -r "${zipPath}" . -x "*.DS_Store" "*.git*" "node_modules/*"`, { stdio: 'inherit' });
  console.log(`\n✅ Build complete!`);
  console.log(`📦 Package: ${zipPath}`);
  
  if (isChromeStore) {
    console.log('\n✨ Ready for Chrome Web Store submission!');
    console.log('📋 Next steps:');
    console.log('   1. Go to Chrome Web Store Developer Dashboard');
    console.log('   2. Upload the zip file');
    console.log('   3. Fill in store listing details');
  } else if (isProduction) {
    console.log('\n🔒 Production build: Code minified, console.log removed');
  } else {
    console.log('\n🔧 Clean build: Unminified code for development');
  }
} catch (error) {
  console.error('\n❌ Error creating zip file:', error.message);
  console.log('\n💡 Tip: Make sure you have zip command installed');
  console.log('   macOS: Already installed');
  console.log('   Linux: sudo apt-get install zip');
  console.log('   Windows: Install Git Bash or use PowerShell Compress-Archive');
  process.exit(1);
}
