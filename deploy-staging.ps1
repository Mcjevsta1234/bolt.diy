# Deployment script for Bolt.diy SaaS v1 - Staging (PowerShell)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Bolt.diy SaaS v1 - Staging Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if wrangler is installed
Write-Host "📝 Checking for Wrangler CLI..." -ForegroundColor Yellow
if (!(Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Wrangler CLI not found. Installing..." -ForegroundColor Red
    npm install -g wrangler
}

# Check if logged in
Write-Host "📝 Checking Cloudflare authentication..." -ForegroundColor Yellow
try {
    wrangler whoami 2>&1 | Out-Null
} catch {
    Write-Host "🔐 Please login to Cloudflare:" -ForegroundColor Yellow
    wrangler login
}

# Build the project
Write-Host ""
Write-Host "🔨 Building project..." -ForegroundColor Yellow
pnpm run build

# Deploy to Cloudflare Pages
Write-Host ""
Write-Host "☁️  Deploying to Cloudflare Pages..." -ForegroundColor Yellow
wrangler pages deploy ./build/client --project-name bolt-staging --branch staging

Write-Host ""
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Set Cloudflare secrets (if not already set):"
Write-Host "   wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name bolt-staging"
Write-Host "   wrangler pages secret put SAAS_SUPABASE_URL --project-name bolt-staging"
Write-Host "   wrangler pages secret put SAAS_SUPABASE_SERVICE_ROLE_KEY --project-name bolt-staging"
Write-Host "   wrangler pages secret put SAAS_SUPABASE_STORAGE_BUCKET --project-name bolt-staging"
Write-Host "   wrangler pages secret put ADMIN_EMAIL_ALLOWLIST --project-name bolt-staging"
Write-Host ""
Write-Host "2. Apply Supabase migrations (see SUPABASE_SETUP.md)"
Write-Host "3. Create storage bucket 'project-snapshots'"
Write-Host "4. Test deployment at your Cloudflare Pages URL"
Write-Host ""
