#!/bin/bash

# Script to create placeholder icons for development
# Requires ImageMagick (install with: brew install imagemagick)

ICON_DIR="public/icons"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Please install it first:"
    echo "  macOS: brew install imagemagick"
    echo "  Ubuntu: sudo apt-get install imagemagick"
    echo "  Windows: Download from https://imagemagick.org/script/download.php"
    exit 1
fi

# Create icons directory if it doesn't exist
mkdir -p "$ICON_DIR"

# Create a simple gradient icon
echo "Creating placeholder icons..."

# Create 128x128 icon
convert -size 128x128 gradient:blue-purple \
    -gravity center \
    -pointsize 48 -fill white -annotate +0+0 "NT" \
    "$ICON_DIR/icon128.png"

# Resize to create smaller versions
convert "$ICON_DIR/icon128.png" -resize 48x48 "$ICON_DIR/icon48.png"
convert "$ICON_DIR/icon128.png" -resize 16x16 "$ICON_DIR/icon16.png"

echo "✓ Placeholder icons created successfully!"
echo "  - icon16.png"
echo "  - icon48.png"
echo "  - icon128.png"
