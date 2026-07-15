#!/bin/bash

set -e

echo "🔨 Building Prometheus for Render..."

# Install Go
apt-get update
apt-get install -y golang-go git

# Clone Prometheus
if [ ! -d "Prometheus" ]; then
    git clone https://github.com/wcrddn/Prometheus.git
fi

# Build Prometheus
cd Prometheus
go build -o prometheus
chmod +x prometheus

# Copy ke root
cp prometheus ../

cd ..

echo "✅ Build complete!"
ls -la prometheus
