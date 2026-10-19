// A stand-in stdio server: it prints the arguments and the environment variables it
// was started with as one JSON line, so a test can check what reached the process.
// ECHO_ARGV_ENV_NAMES picks which environment variables to report (comma-separated).
const names = (process.env.ECHO_ARGV_ENV_NAMES ?? '').split(',').filter(Boolean)
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  env: Object.fromEntries(names.map(name => [name, process.env[name] ?? null])),
}))
