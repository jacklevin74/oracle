#!/bin/bash
# Build script that fixes Cargo.lock version issue

rm -f Cargo.lock

# Loop until build succeeds
MAX_ATTEMPTS=10
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "Build attempt $ATTEMPT of $MAX_ATTEMPTS..."

    # Try to build
    anchor build 2>&1 | tee /tmp/build-attempt-$ATTEMPT.log
    BUILD_EXIT=$?

    # Check if Cargo.lock exists and fix version
    if [ -f "Cargo.lock" ]; then
        sed -i.bak 's/version = 4/version = 3/' Cargo.lock
    fi

    # If build succeeded, break
    if [ $BUILD_EXIT -eq 0 ] && [ -f "target/deploy/oracle.so" ] && [ -f "target/deploy/oracle_v3.so" ]; then
        echo "Build successful!"
        exit 0
    fi

    # Check if it's just the lockfile error
    if grep -q "lock file version 4" /tmp/build-attempt-$ATTEMPT.log; then
        echo "Fixing lockfile version and retrying..."
        ATTEMPT=$((ATTEMPT + 1))
        continue
    else
        # Different error, show it and exit
        echo "Build failed with different error:"
        tail -50 /tmp/build-attempt-$ATTEMPT.log
        exit 1
    fi
done

echo "Max attempts reached"
exit 1
