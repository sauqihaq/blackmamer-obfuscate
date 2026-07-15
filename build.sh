#!/bin/bash

echo "🔨 Building Prometheus for Render..."

# Install Go if not available
if ! command -v go &> /dev/null; then
    echo "Installing Go..."
    apt-get update && apt-get install -y golang-go git
fi

# Clone Prometheus if not exists
if [ ! -d "Prometheus" ]; then
    echo "Cloning Prometheus..."
    git clone https://github.com/wcrddn/Prometheus.git
fi

# Build Prometheus
cd Prometheus
echo "Building Prometheus..."
go build -o prometheus

# Copy binary to root
cp prometheus ../

cd ..

echo "✅ Build complete!"
ls -la prometheus
