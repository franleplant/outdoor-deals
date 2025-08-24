#!/bin/bash

# Setup Daily Update Script
# This script configures a cron job to update the dashboard every morning at 8 AM

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRON_COMMAND="0 8 * * * cd $SCRIPT_DIR && ./update-dashboard.sh"

echo "🔧 Setting up daily dashboard updates..."
echo "📍 Project directory: $SCRIPT_DIR"
echo "⏰ Scheduled time: 8:00 AM daily"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$SCRIPT_DIR/update-dashboard.sh"; then
    echo "⚠️  Cron job already exists for this project"
    echo "📋 Current cron jobs:"
    crontab -l | grep "$SCRIPT_DIR"
    
    read -p "🔄 Replace existing cron job? (y/N): " replace
    if [[ $replace =~ ^[Yy]$ ]]; then
        # Remove existing cron job for this project
        crontab -l | grep -v "$SCRIPT_DIR/update-dashboard.sh" | crontab -
        echo "🗑️  Removed existing cron job"
    else
        echo "❌ Setup cancelled"
        exit 0
    fi
fi

# Add the new cron job
(crontab -l 2>/dev/null; echo "$CRON_COMMAND") | crontab -

if [ $? -eq 0 ]; then
    echo "✅ Cron job added successfully!"
    echo "📅 The dashboard will update automatically every morning at 8:00 AM"
    echo "🔍 To verify, run: crontab -l"
    echo ""
    echo "📋 Current cron jobs:"
    crontab -l
else
    echo "❌ Failed to add cron job"
    exit 1
fi

echo ""
echo "🧪 To test the update manually, run:"
echo "   ./update-dashboard.sh --open"
echo ""
echo "🗑️  To remove the cron job later, run:"
echo "   crontab -e"
echo "   # Then delete the line containing: $SCRIPT_DIR/update-dashboard.sh"
