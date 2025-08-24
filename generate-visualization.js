#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to parse CSV
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = [];
        let currentValue = '';
        let insideQuotes = false;
        
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                insideQuotes = !insideQuotes;
            } else if (char === ',' && !insideQuotes) {
                values.push(currentValue);
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        values.push(currentValue);
        
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }
    return data;
}

// Function to generate HTML template
function generateHTML(csvData) {
    const escapedCsvData = csvData.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Outdoor Deals Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
        }

        .header h1 {
            color: #333;
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .header p {
            color: #666;
            font-size: 1.1rem;
        }

        .last-updated {
            text-align: center;
            color: #888;
            font-size: 0.9rem;
            margin-bottom: 20px;
            font-style: italic;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }

        .stat-card {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 20px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .stat-card h3 {
            font-size: 0.9rem;
            margin-bottom: 10px;
            opacity: 0.9;
        }

        .stat-card .value {
            font-size: 2rem;
            font-weight: bold;
        }

        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }

        .chart-container {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(0, 0, 0, 0.05);
        }

        .chart-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 20px;
            text-align: center;
        }

        .chart-wrapper {
            position: relative;
            height: 300px;
        }

        .deals-table {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(0, 0, 0, 0.05);
            margin-top: 30px;
        }

        .deals-table h3 {
            font-size: 1.3rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 20px;
            text-align: center;
        }

        .table-wrapper {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }

        th {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        tr:hover {
            background: rgba(102, 126, 234, 0.05);
        }

        .discount-badge {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 4px 8px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }

        .price {
            font-weight: 600;
        }

        .original-price {
            text-decoration: line-through;
            color: #999;
            margin-right: 8px;
        }

        .sale-price {
            color: #e74c3c;
        }

        .deals-table a {
            color: #667eea;
            text-decoration: none;
            transition: color 0.3s ease;
        }

        .deals-table a:hover {
            color: #764ba2;
            text-decoration: underline;
        }

        @media (max-width: 768px) {
            .charts-grid {
                grid-template-columns: 1fr;
            }
            
            .container {
                padding: 20px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏕️ Outdoor Deals Dashboard</h1>
            <p>Comprehensive analysis of outdoor gear deals and discounts</p>
        </div>

        <div class="last-updated">
            Last updated: ${new Date().toLocaleString()}
        </div>

        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be populated by JavaScript -->
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">Discount Distribution</div>
                <div class="chart-wrapper">
                    <canvas id="discountChart"></canvas>
                </div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Price Comparison</div>
                <div class="chart-wrapper">
                    <canvas id="priceChart"></canvas>
                </div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Brand Breakdown</div>
                <div class="chart-wrapper">
                    <canvas id="brandChart"></canvas>
                </div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Price Range Distribution</div>
                <div class="chart-wrapper">
                    <canvas id="priceRangeChart"></canvas>
                </div>
            </div>
        </div>

        <div class="deals-table">
            <h3>📊 All Deals</h3>
            <div class="table-wrapper">
                <table id="dealsTable">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Brand</th>
                            <th>Original Price</th>
                            <th>Sale Price</th>
                            <th>Discount</th>
                            <th>Savings</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Table rows will be populated by JavaScript -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // CSV data embedded in JavaScript
        const csvData = \`${escapedCsvData}\`;

        // Parse CSV data
        function parseCSV(csv) {
            const lines = csv.split('\\n');
            const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
            const data = [];
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim()) {
                    const values = [];
                    let currentValue = '';
                    let insideQuotes = false;
                    
                    for (let j = 0; j < line.length; j++) {
                        const char = line[j];
                        if (char === '"') {
                            insideQuotes = !insideQuotes;
                        } else if (char === ',' && !insideQuotes) {
                            values.push(currentValue);
                            currentValue = '';
                        } else {
                            currentValue += char;
                        }
                    }
                    values.push(currentValue);
                    
                    const row = {};
                    headers.forEach((header, index) => {
                        row[header] = values[index] || '';
                    });
                    data.push(row);
                }
            }
            return data;
        }

        // Parse the data
        const deals = parseCSV(csvData);

        // Calculate statistics
        function calculateStats(data) {
            const totalDeals = data.length;
            const avgDiscount = data.reduce((sum, deal) => sum + parseFloat(deal.discount_pct), 0) / data.length;
            const maxDiscount = Math.max(...data.map(deal => parseFloat(deal.discount_pct)));
            const totalSavings = data.reduce((sum, deal) => {
                const listPrice = parseFloat(deal.list_price);
                const salePrice = parseFloat(deal.sale_price);
                return sum + (listPrice - salePrice);
            }, 0);

            return {
                totalDeals,
                avgDiscount: (avgDiscount * 100).toFixed(1),
                maxDiscount: (maxDiscount * 100).toFixed(1),
                totalSavings: totalSavings.toFixed(2)
            };
        }

        const stats = calculateStats(deals);

        // Populate stats grid
        function populateStats() {
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = \`
                <div class="stat-card">
                    <h3>Total Deals</h3>
                    <div class="value">\${stats.totalDeals}</div>
                </div>
                <div class="stat-card">
                    <h3>Average Discount</h3>
                    <div class="value">\${stats.avgDiscount}%</div>
                </div>
                <div class="stat-card">
                    <h3>Best Deal</h3>
                    <div class="value">\${stats.maxDiscount}%</div>
                </div>
                <div class="stat-card">
                    <h3>Total Savings</h3>
                    <div class="value">$\${stats.totalSavings}</div>
                </div>
            \`;
        }

        // Create discount distribution chart
        function createDiscountChart() {
            const ctx = document.getElementById('discountChart').getContext('2d');
            const discounts = deals.map(deal => (parseFloat(deal.discount_pct) * 100).toFixed(0));
            const productNames = deals.map(deal => deal.name.substring(0, 30) + '...');
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: productNames,
                    datasets: [{
                        label: 'Discount %',
                        data: discounts,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Discount Percentage'
                            }
                        },
                        x: {
                            display: false
                        }
                    }
                }
            });
        }

        // Create price comparison chart
        function createPriceChart() {
            const ctx = document.getElementById('priceChart').getContext('2d');
            const listPrices = deals.map(deal => parseFloat(deal.list_price));
            const salePrices = deals.map(deal => parseFloat(deal.sale_price));
            const productNames = deals.map((deal, index) => \`Product \${index + 1}\`);
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: productNames,
                    datasets: [{
                        label: 'List Price',
                        data: listPrices,
                        borderColor: 'rgba(231, 76, 60, 1)',
                        backgroundColor: 'rgba(231, 76, 60, 0.2)',
                        tension: 0.1
                    }, {
                        label: 'Sale Price',
                        data: salePrices,
                        borderColor: 'rgba(102, 126, 234, 1)',
                        backgroundColor: 'rgba(102, 126, 234, 0.2)',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Price ($)'
                            }
                        },
                        x: {
                            display: false
                        }
                    }
                }
            });
        }

        // Create brand breakdown chart
        function createBrandChart() {
            const ctx = document.getElementById('brandChart').getContext('2d');
            const brandCounts = {};
            
            deals.forEach(deal => {
                // Extract brand from product name
                let brand = 'Unknown';
                if (deal.name.toLowerCase().includes('columbia')) brand = 'Columbia';
                else if (deal.name.toLowerCase().includes('patagonia')) brand = 'Patagonia';
                else if (deal.name.toLowerCase().includes('marmot')) brand = 'Marmot';
                else if (deal.name.toLowerCase().includes('oboz')) brand = 'Oboz';
                else if (deal.name.toLowerCase().includes('sorel')) brand = 'Sorel';
                
                brandCounts[brand] = (brandCounts[brand] || 0) + 1;
            });
            
            const brands = Object.keys(brandCounts);
            const counts = Object.values(brandCounts);
            const colors = ['#667eea', '#764ba2', '#e74c3c', '#f39c12', '#27ae60'];
            
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: brands,
                    datasets: [{
                        data: counts,
                        backgroundColor: colors.slice(0, brands.length),
                        borderWidth: 2,
                        borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        }
                    }
                }
            });
        }

        // Create price range distribution chart
        function createPriceRangeChart() {
            const ctx = document.getElementById('priceRangeChart').getContext('2d');
            const ranges = {
                '$0-50': 0,
                '$51-100': 0,
                '$101-200': 0,
                '$201-300': 0,
                '$300+': 0
            };
            
            deals.forEach(deal => {
                const price = parseFloat(deal.list_price);
                if (price <= 50) ranges['$0-50']++;
                else if (price <= 100) ranges['$51-100']++;
                else if (price <= 200) ranges['$101-200']++;
                else if (price <= 300) ranges['$201-300']++;
                else ranges['$300+']++;
            });
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(ranges),
                    datasets: [{
                        label: 'Number of Products',
                        data: Object.values(ranges),
                        backgroundColor: 'rgba(118, 75, 162, 0.8)',
                        borderColor: 'rgba(118, 75, 162, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Products'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Price Range'
                            }
                        }
                    }
                }
            });
        }

        // Populate deals table
        function populateTable() {
            const tbody = document.querySelector('#dealsTable tbody');
            tbody.innerHTML = '';
            
            // Sort deals by discount percentage (highest first)
            const sortedDeals = [...deals].sort((a, b) => parseFloat(b.discount_pct) - parseFloat(a.discount_pct));
            
            sortedDeals.forEach(deal => {
                const listPrice = parseFloat(deal.list_price);
                const salePrice = parseFloat(deal.sale_price);
                const discount = (parseFloat(deal.discount_pct) * 100).toFixed(0);
                const savings = (listPrice - salePrice).toFixed(2);
                
                // Extract brand from product name
                let brand = 'Unknown';
                if (deal.name.toLowerCase().includes('columbia')) brand = 'Columbia';
                else if (deal.name.toLowerCase().includes('patagonia')) brand = 'Patagonia';
                else if (deal.name.toLowerCase().includes('marmot')) brand = 'Marmot';
                else if (deal.name.toLowerCase().includes('oboz')) brand = 'Oboz';
                else if (deal.name.toLowerCase().includes('sorel')) brand = 'Sorel';
                
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td><a href="\${deal.url}" target="_blank">\${deal.name}</a></td>
                    <td>\${brand}</td>
                    <td class="price">
                        <span class="original-price">$\${listPrice}</span>
                    </td>
                    <td class="price">
                        <span class="sale-price">$\${salePrice}</span>
                    </td>
                    <td>
                        <span class="discount-badge">\${discount}% OFF</span>
                    </td>
                    <td class="price">$\${savings}</td>
                \`;
                tbody.appendChild(row);
            });
        }

        // Initialize the dashboard
        function init() {
            populateStats();
            createDiscountChart();
            createPriceChart();
            createBrandChart();
            createPriceRangeChart();
            populateTable();
        }

        // Load the dashboard when the page is ready
        document.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>`;
}

// Main function
function main() {
    try {
        const csvPath = path.join(__dirname, 'out', 'deals.csv');
        const outputPath = path.join(__dirname, 'deals-dashboard.html');
        
        if (!fs.existsSync(csvPath)) {
            console.error('Error: deals.csv not found in out/ directory');
            process.exit(1);
        }
        
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const html = generateHTML(csvData);
        
        fs.writeFileSync(outputPath, html);
        console.log(`✅ Dashboard generated successfully: ${outputPath}`);
        console.log(`📊 Last updated: ${new Date().toLocaleString()}`);
        
        // Also update the original visualization file for backward compatibility
        const originalPath = path.join(__dirname, 'deals-visualization.html');
        fs.writeFileSync(originalPath, html);
        console.log(`✅ Updated original visualization: ${originalPath}`);
        
    } catch (error) {
        console.error('Error generating dashboard:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { generateHTML, parseCSV };
