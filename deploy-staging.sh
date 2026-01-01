#!/bin/bash
# Deployment script for Bolt.diy SaaS v1 - Staging

set -e  # Exit on error

echo "🚀 Bolt.diy SaaS v1 - Staging Deployment"
echo "========================================"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

# Check if logged in
echo "📝 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Please login to Cloudflare:"
    wrangler login
fi

# Build the project
echo ""
echo "🔨 Building project..."
pnpm run build

# Deploy to Cloudflare Pages
echo ""
echo "☁️  Deploying to Cloudflare Pages..."
wrangler pages deploy ./build/client --project-name bolt-staging --branch staging

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set Cloudflare secrets (if not already set):"
echo "   wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name bolt-staging"
echo "   wrangler pages secret put SAAS_SUPABASE_URL --project-name bolt-staging"
echo "   wrangler pages secret put SAAS_SUPABASE_SERVICE_ROLE_KEY --project-name bolt-staging"
echo "   wrangler pages secret put SAAS_SUPABASE_STORAGE_BUCKET --project-name bolt-staging"
echo "   wrangler pages secret put ADMIN_EMAIL_ALLOWLIST --project-name bolt-staging"
echo ""
echo "2. Apply Supabase migrations (see SUPABASE_SETUP.md)"
echo "3. Create storage bucket 'project-snapshots'"
echo "4. Test deployment at your Cloudflare Pages URL"
echo ""
