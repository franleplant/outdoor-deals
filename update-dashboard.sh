#!/bin/bash

# Update Dashboard Script
# This script runs the scraper and updates the visualization dashboard

cd "$(dirname "$0")" || exit 1

echo "🔄 Starting daily deals update..."
echo "⏰ $(date)"

# Run the scraper
echo "🕷️  Running scraper..."
if node scraper.mjs; then
    echo "✅ Scraper completed successfully"
else
    echo "❌ Scraper failed"
    exit 1
fi

# Generate new visualization
echo "📊 Generating dashboard..."
if node generate-visualization.js; then
    echo "✅ Dashboard updated successfully"
else
    echo "❌ Dashboard generation failed"
    exit 1
fi

# Optional: Open the dashboard (remove if running via cron)
if [[ "$1" == "--open" ]]; then
    echo "🌐 Opening dashboard..."
    open deals-dashboard.html
fi

echo "🎉 Daily update completed at $(date)"
echo "📈 Dashboard available at: $(pwd)/deals-dashboard.html"
