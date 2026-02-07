#!/bin/bash
# Test Runner for Private DAO Voting
# Usage: ./scripts/test.sh [unit|integration|e2e|all]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Run Rust unit tests for the Arcis circuit
run_arcis_tests() {
    print_header "Running Arcis Circuit Unit Tests"
    
    cd src/encrypted-ixs
    if cargo test --lib 2>&1; then
        print_success "Arcis circuit tests passed"
    else
        print_error "Arcis circuit tests failed"
        exit 1
    fi
    cd ../..
}

# Run Rust integration tests for the Anchor program
run_anchor_rust_tests() {
    print_header "Running Anchor Program Integration Tests (Rust)"
    
    cd programs/private-dao-voting
    if cargo test 2>&1; then
        print_success "Anchor Rust tests passed"
    else
        print_error "Anchor Rust tests failed"
        exit 1
    fi
    cd ../..
}

# Run TypeScript unit tests (mock Arcium)
run_ts_unit_tests() {
    print_header "Running TypeScript Unit Tests"
    
    if npm run test:unit 2>&1; then
        print_success "TypeScript unit tests passed"
    else
        print_error "TypeScript unit tests failed"
        exit 1
    fi
}

# Run TypeScript E2E tests with local validator
run_e2e_tests() {
    print_header "Running E2E Tests with Local Validator"
    
    print_warning "Starting local Solana validator..."
    
    # Check if validator is already running
    if ! solana-test-validator --version > /dev/null 2>&1; then
        print_error "solana-test-validator not found. Please install Solana CLI."
        exit 1
    fi
    
    # Run anchor test
    if anchor test 2>&1; then
        print_success "E2E tests passed"
    else
        print_error "E2E tests failed"
        exit 1
    fi
}

# Build everything first
build_all() {
    print_header "Building Project"
    
    # Build Anchor program
    if anchor build 2>&1; then
        print_success "Anchor program built successfully"
    else
        print_error "Anchor build failed"
        exit 1
    fi
    
    # Build Arcis circuit (if arcis CLI is available)
    if command -v arcis &> /dev/null; then
        cd src/encrypted-ixs
        if arcis build 2>&1; then
            print_success "Arcis circuit built successfully"
        else
            print_warning "Arcis build failed (may not be configured)"
        fi
        cd ../..
    else
        print_warning "Arcis CLI not found, skipping circuit build"
    fi
}

# Install dependencies
install_deps() {
    print_header "Installing Dependencies"
    
    if npm install 2>&1; then
        print_success "npm dependencies installed"
    else
        print_error "npm install failed"
        exit 1
    fi
}

# Main test runner
main() {
    local test_type="${1:-all}"
    
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════╗"
    echo "║     Private DAO Voting Test Suite        ║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${NC}"
    
    case $test_type in
        unit)
            run_arcis_tests
            run_ts_unit_tests
            ;;
        integration)
            build_all
            run_anchor_rust_tests
            ;;
        e2e)
            install_deps
            build_all
            run_e2e_tests
            ;;
        all)
            install_deps
            build_all
            run_arcis_tests
            run_anchor_rust_tests
            run_ts_unit_tests
            run_e2e_tests
            ;;
        *)
            echo "Usage: $0 [unit|integration|e2e|all]"
            echo ""
            echo "  unit        - Run unit tests only (Arcis + TS mocks)"
            echo "  integration - Run Rust integration tests"
            echo "  e2e         - Run full E2E tests with validator"
            echo "  all         - Run all tests (default)"
            exit 1
            ;;
    esac
    
    echo ""
    print_header "Test Summary"
    print_success "All tests completed successfully!"
}

# Run main function
main "$@"
