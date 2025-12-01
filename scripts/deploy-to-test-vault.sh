#!/bin/bash
# Deploy plugin to test vault after building

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PROJECT_DIR="/mnt/c/Users/Cybersader/Documents/4 VAULTS/plugin_development/dynamic-tags-folders-plugin"
TEST_VAULT="/mnt/c/Users/Cybersader/Documents/4 VAULTS/dynamic-tags-test-vault"
PLUGIN_DIR="$TEST_VAULT/.obsidian/plugins/dynamic-tags-folders"

echo -e "${BLUE}Building plugin...${NC}"
cd "$PROJECT_DIR"
/home/cybersader/.bun/bin/bun run build

if [ $? -ne 0 ]; then
  echo -e "${RED}Build failed!${NC}"
  exit 1
fi

echo -e "${GREEN}Build successful!${NC}"

echo -e "${BLUE}Copying files to test vault...${NC}"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

if [ $? -ne 0 ]; then
  echo -e "${RED}Copy failed!${NC}"
  exit 1
fi

echo -e "${GREEN}Plugin deployed to test vault!${NC}"
echo -e "${BLUE}Location: $PLUGIN_DIR${NC}"
echo ""
echo "Next steps:"
echo "1. Reload Obsidian (or use hot-reload plugin)"
echo "2. Check debug log: cat \"$PLUGIN_DIR/debug.log\""
echo ""
