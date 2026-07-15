#!/bin/bash

echo "🔨 Building Prometheus..."

# Clone Prometheus
if [ ! -d "Prometheus" ]; then
    git clone https://github.com/wcrddn/Prometheus.git
fi

cd Prometheus

# Build Prometheus
go build -o prometheus

# Copy binary ke root
cp prometheus ../

cd ..

# Build wrapper Go
go build -o prometheus-wrapper prometheus.go

echo "✅ Build complete!"
