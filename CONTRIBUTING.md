# Contributing to NotOnlyTranslator

Thank you for your interest in contributing to NotOnlyTranslator! This document provides guidelines for contributing to the project.

## Code of Conduct

Please be respectful and constructive in all interactions with the community.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue with:
- A clear, descriptive title
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Browser version and OS

### Suggesting Features

Feature suggestions are welcome! Please open an issue with:
- A clear description of the feature
- Use cases and benefits
- Any implementation ideas you have

### Pull Requests

1. **Fork the repository** and create a branch from `main`

2. **Make your changes**:
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes**:
   - Build the extension: `npm run build`
   - Load it in Chrome and test thoroughly
   - Ensure no TypeScript errors: `npm run lint`

4. **Commit your changes**:
   - Use clear, descriptive commit messages
   - Reference issue numbers if applicable

5. **Submit a pull request**:
   - Describe what changes you made and why
   - Link to any related issues
   - Request review from maintainers

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/notOnlyTranslator.git
cd notOnlyTranslator

# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build
```

## Code Style

- Use TypeScript for all new code
- Follow the existing code structure
- Use meaningful variable and function names
- Add TypeScript types for all parameters and return values
- Use Tailwind CSS for styling (avoid inline styles)

## Project Structure

- `src/background/` - Service worker and background logic
- `src/content/` - Content scripts that run on web pages
- `src/popup/` - Extension popup UI
- `src/options/` - Settings page UI
- `src/shared/` - Shared utilities, types, and constants

## Questions?

If you have questions, feel free to open an issue or reach out to the maintainers.

Thank you for contributing! 🎉
