# scripts/

### check-source-docs-up-to-date

Checks that there is a documentation entry for each source file and script in the README.md in the same directory.

### nod

Used to run a command with a specified Node version:

To run the tests with Node 14:
```bash
$ ./scripts/nod 14 npm test
```
If a matching Node version isn't already installed, nod will attempt to find and install one.

The command provded after the version is then run, with the correct version of Node in the path.

Tested and working on Windows 10, macOS and Ubuntu, but doesn't seem to work in the docker dev env.

### release

Used to prepare and release new versions of raygun-apm. Performs a number of checks and runs prerelease steps, and will then build, tag and push the release.

For more information, run `./scripts/release --help` or see `DEVELOPING.md` for the release process.

### test-dependency-versions

Used to run our tests against new versions of supported third party libraries. Pulls information from the `supported-libraries.json` file and populates `supported-libraries-lock.json` with the results.

To test all new versions:
```bash
$ ./scripts/test-dependency-versions
```

To test a specific version:
```bash
$ ./scripts/test-dependency-versions pg@8.4.1
```

Sets the exit code to 0 on success and nonzero on failure.

### test-package-installation

Used to check that raygun-apm can be installed without any errors. Runs as part of the prerelease process.

```bash
$ ./scripts/test-package-installation
```

Sets the exit code to 0 on success and nonzero on failure.

### test-with-all-node-versions

Used to run the test suite on a range of Node versions in sequence.

To test all supported versions:
```bash
$ ./scripts/test-with-all-node-versions
```

To test only LTS releases:
```bash
$ ./scripts/test-with-all-node-versions 12 14
```

### wire-test

An interpreter for sending wire protocol messages to the agent, mostly useful for testing how the agent processes specific traces that are hard to catch in the wild.

Takes a path to a wire test as the first argument. Wire tests can be found in the `wire-tests/` directory.

To send a simple wire test:
```bash
$ ./scripts/wire-test ./wire-tests/timer_frames.js
```
