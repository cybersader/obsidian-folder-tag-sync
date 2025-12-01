# Environment Setup Guide

Complete setup instructions for developing the Dynamic Tags & Folders plugin in different environments.

## Table of Contents

1. [Choosing Your Environment](#choosing-your-environment)
2. [WSL (Windows Subsystem for Linux)](#wsl-windows-subsystem-for-linux)
3. [PowerShell (Windows Native)](#powershell-windows-native)
4. [Linux (Native)](#linux-native)
5. [macOS](#macos)
6. [Switching Between Environments](#switching-between-environments)
7. [Claude Code Considerations](#claude-code-considerations)
8. [Troubleshooting](#troubleshooting)

---

## Choosing Your Environment

Each environment has trade-offs:

| Environment | Pros | Cons | Best For |
|-------------|------|------|----------|
| **WSL** | Linux tools + Windows filesystem access | Permission complexity | Windows users who prefer bash |
| **PowerShell** | Native Windows, no permission issues | Different command syntax | Windows users who prefer PowerShell |
| **Linux** | Pure Linux, fast, simple | No direct Windows access | Linux users |
| **macOS** | Unix-like, native | Apple hardware only | Mac users |

**Recommendation**:
- **Windows users**: WSL for better tooling, PowerShell for simplicity
- **Linux/Mac users**: Use your native environment

---

## WSL (Windows Subsystem for Linux)

### Prerequisites

#### 1. Enable WSL

```powershell
# In PowerShell (Admin)
wsl --install
```

Restart your computer when prompted.

#### 2. Install a Linux Distribution

```powershell
# List available distributions
wsl --list --online

# Install Ubuntu (recommended)
wsl --install -d Ubuntu

# Or install from Microsoft Store:
# - Ubuntu 22.04 LTS (recommended)
# - Ubuntu 20.04 LTS
# - Debian
```

#### 3. Set Up Linux User

When you first launch Ubuntu, you'll be prompted to create a username and password.

**Important**: Remember this password - you'll need it for `sudo` commands.

### Install Development Tools

#### 1. Update Package Manager

```bash
sudo apt update
sudo apt upgrade -y
```

#### 2. Install Node.js (if using npm)

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

#### 3. Install bun (Recommended)

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Add bun to PATH (add to ~/.bashrc or ~/.zshrc)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc

# Reload shell configuration
source ~/.bashrc

# Verify installation
bun --version
```

#### 4. Install Git

```bash
sudo apt install -y git

# Configure git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### File Permissions in WSL

WSL can have complex permission issues when working with Windows files.

#### Understanding Permissions

```bash
# Check current permissions
ls -la

# Files owned by root (created by Claude Code or sudo)
-rw-r--r-- 1 root root 1234 Dec 01 12:00 file.txt

# Files owned by you
-rw-r--r-- 1 youruser youruser 1234 Dec 01 12:00 file.txt
```

#### Fixing Permission Issues

```bash
# If files are owned by root, reclaim ownership
sudo chown -R $USER:$USER .

# Make files writable
chmod -R u+w .

# After fixing permissions, reinstall dependencies
rm -rf node_modules
bun install
```

#### Preventing Permission Issues

1. **Avoid using sudo** unless absolutely necessary
2. **Clone repos in WSL home directory** (`~`) for better permissions
3. **Use WSL paths** (`/home/user/`) instead of Windows paths (`/mnt/c/Users/...`)

### Accessing Windows Files

```bash
# Windows drives are mounted under /mnt/
cd /mnt/c/Users/YourUsername/Documents

# Create symlink to Windows directory (optional)
ln -s /mnt/c/Users/YourUsername/Documents/ObsidianVault ~/obsidian-vault
```

### Clone and Setup

```bash
# Navigate to your project directory
cd /mnt/c/Users/YourUsername/Documents/4\ VAULTS/plugin_development

# Clone the repository
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper

# Install dependencies
bun install

# Verify setup
bun test
bun x tsc -noEmit -skipLibCheck
```

---

## PowerShell (Windows Native)

### Prerequisites

#### 1. Install Package Manager

**Option A: Scoop (Recommended)**

```powershell
# Install Scoop
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex

# Install packages
scoop install git nodejs bun
```

**Option B: Chocolatey**

```powershell
# Install Chocolatey (Admin PowerShell)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install packages
choco install git nodejs bun
```

**Option C: Manual Installation**

1. **Node.js**: Download from [nodejs.org](https://nodejs.org/)
2. **Git**: Download from [git-scm.com](https://git-scm.com/)
3. **bun**: Download from [bun.sh](https://bun.sh/)

#### 2. Verify Installations

```powershell
# Check versions
node --version
npm --version
bun --version
git --version
```

### Configure Git

```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Clone and Setup

```powershell
# Navigate to your project directory
cd C:\Users\YourUsername\Documents\4 VAULTS\plugin_development

# Clone the repository
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper

# Install dependencies
bun install

# Verify setup
bun test
bun x tsc -noEmit -skipLibCheck
```

### PowerShell Tips

#### Enable Long Paths (Windows)

```powershell
# Enable long paths in registry (Admin PowerShell)
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

#### Execution Policy

```powershell
# If you get execution policy errors
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Linux (Native)

### Prerequisites

#### Ubuntu/Debian

```bash
# Update package manager
sudo apt update
sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install bun
curl -fsSL https://bun.sh/install | bash

# Add bun to PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Install Git
sudo apt install -y git

# Configure git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

#### Fedora/RHEL

```bash
# Update package manager
sudo dnf update -y

# Install Node.js
sudo dnf install -y nodejs npm

# Install bun
curl -fsSL https://bun.sh/install | bash

# Add bun to PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Install Git
sudo dnf install -y git

# Configure git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

#### Arch Linux

```bash
# Update package manager
sudo pacman -Syu

# Install Node.js
sudo pacman -S nodejs npm

# Install bun
curl -fsSL https://bun.sh/install | bash

# Add bun to PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Install Git
sudo pacman -S git

# Configure git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Clone and Setup

```bash
# Navigate to your project directory
cd ~/projects

# Clone the repository
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper

# Install dependencies
bun install

# Verify setup
bun test
bun x tsc -noEmit -skipLibCheck
```

---

## macOS

### Prerequisites

#### 1. Install Homebrew

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### 2. Install Development Tools

```bash
# Install Node.js
brew install node

# Install bun
curl -fsSL https://bun.sh/install | bash

# Add bun to PATH (add to ~/.zshrc or ~/.bash_profile)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Install Git (usually pre-installed)
brew install git

# Configure git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Clone and Setup

```bash
# Navigate to your project directory
cd ~/Documents/projects

# Clone the repository
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper

# Install dependencies
bun install

# Verify setup
bun test
bun x tsc -noEmit -skipLibCheck
```

### macOS Tips

#### Apple Silicon (M1/M2/M3)

Most tools work natively on Apple Silicon, but if you encounter issues:

```bash
# Check architecture
uname -m
# arm64 = Apple Silicon
# x86_64 = Intel

# Force Rosetta (if needed)
arch -x86_64 bun install
```

---

## Switching Between Environments

### Problem: esbuild Platform Mismatch

When switching environments, you may see:

```
You installed esbuild for another platform than the one you're currently using.
```

**Cause**: esbuild installs platform-specific binaries. If you install in WSL but run in PowerShell (or vice versa), the wrong binaries are present.

### Solution: Reinstall Dependencies

#### From WSL to PowerShell

```powershell
# In PowerShell
Remove-Item -Recurse -Force node_modules
bun install
```

#### From PowerShell to WSL

```bash
# In WSL
rm -rf node_modules
bun install
```

### Best Practice: Separate Environments

**Option 1: Separate Clones**

```bash
# WSL clone
/mnt/c/Users/You/Documents/plugin-dev-wsl/

# PowerShell clone
C:\Users\You\Documents\plugin-dev-ps\
```

**Option 2: Use Platform-Aware Build Script**

The project includes `scripts/build.mjs` which auto-detects your environment:

```bash
# Works in any environment
node scripts/build.mjs
```

---

## Claude Code Considerations

When working with Claude Code, there are special considerations for each environment.

### How Claude Code Works

Claude Code may run commands:
- **As a different user** (potentially root/sudo in WSL)
- **In a different environment** than your shell
- **With different permissions** than your user

### WSL with Claude Code

#### Permission Issues

Claude Code may create files as root:

```bash
# Check file ownership
ls -la

# If owned by root, fix:
sudo chown -R $USER:$USER .

# Reinstall dependencies
rm -rf node_modules
bun install
```

#### Environment Variables

Claude Code's environment may differ from yours:

```bash
# Check Claude Code's environment
echo $PATH
echo $USER
echo $HOME

# If bun is not found, ensure it's in system PATH
# Add to /etc/environment (requires sudo)
```

### PowerShell with Claude Code

#### Execution Policy

Claude Code may have different execution policies:

```powershell
# Check current policy
Get-ExecutionPolicy

# If restricted, set for current user
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Path Issues

Ensure bun and npm are in system PATH, not just user PATH.

### Best Practices

1. **Let Claude Code handle**: TypeScript compilation, testing
2. **You handle**: Final builds, Obsidian testing, git commits
3. **Use platform-aware scripts**: `node scripts/build.mjs`
4. **Verify independently**: Always run `bun test` yourself after changes
5. **Fix permissions**: Use `chown` in WSL if files are owned by root

---

## Troubleshooting

### Common Issues

#### Issue: `command not found: bun`

**WSL/Linux/macOS:**

```bash
# Check if bun is installed
ls ~/.bun/bin/bun

# If exists, add to PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# If doesn't exist, install
curl -fsSL https://bun.sh/install | bash
```

**PowerShell:**

```powershell
# Check if bun is installed
Get-Command bun

# If not found, reinstall
irm bun.sh/install.ps1 | iex
```

#### Issue: `Permission denied`

**WSL/Linux:**

```bash
# Fix ownership
sudo chown -R $USER:$USER .

# Fix permissions
chmod -R u+w .
```

**PowerShell:**

```powershell
# Run as Administrator
# Right-click PowerShell → "Run as Administrator"
```

#### Issue: `esbuild platform mismatch`

See [Switching Between Environments](#switching-between-environments) above.

#### Issue: `EACCES: permission denied, mkdir`

**WSL:**

```bash
# Change npm global directory to user directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

**PowerShell:**

```powershell
# Run as Administrator
# Or use scoop/chocolatey which handle permissions
```

#### Issue: Git line ending warnings

```bash
# Configure git to handle line endings
git config --global core.autocrlf true   # Windows
git config --global core.autocrlf input  # Linux/Mac
```

#### Issue: `Can't find Python executable`

Some npm packages require Python for native modules:

**WSL/Linux:**

```bash
sudo apt install -y python3
```

**macOS:**

```bash
brew install python3
```

**PowerShell:**

```powershell
scoop install python
# or
choco install python
```

### Getting Help

If you encounter environment-specific issues:

1. Check this guide first
2. Check [TESTING_GUIDE.md](./TESTING_GUIDE.md) for testing issues
3. Check [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow
4. Search [existing issues](https://github.com/cybersader/obsidian-tag-and-folder-mapper/issues)
5. Open a new issue with:
   - Your environment (WSL/PowerShell/Linux/macOS)
   - Output of `bun --version`, `node --version`
   - Full error message
   - Steps to reproduce

---

## Quick Reference

### Installation Commands

```bash
# WSL/Linux
sudo apt update && sudo apt install -y git nodejs
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

# macOS
brew install git node
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

```powershell
# PowerShell
irm get.scoop.sh | iex
scoop install git nodejs bun
```

### Verify Installation

```bash
# All environments
git --version
node --version
bun --version
```

### Project Setup

```bash
# All environments
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper
bun install
bun test
```

### Fix Common Issues

```bash
# WSL: Fix permissions
sudo chown -R $USER:$USER . && rm -rf node_modules && bun install

# All: Fix platform mismatch
rm -rf node_modules && bun install
```

---

## Next Steps

After setting up your environment:

1. **Verify installation**: Run `bun test` to ensure 156 tests pass
2. **Read the guides**:
   - [CONTRIBUTING.md](./CONTRIBUTING.md) - Development workflow
   - [TESTING_GUIDE.md](./TESTING_GUIDE.md) - How to test in Obsidian
3. **Start developing**: Make changes and run `bun run dev` for hot reload
4. **Test in Obsidian**: Create a test vault and load the plugin

---

## License

By using this setup guide, you agree to contribute under the MIT License.
