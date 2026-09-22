#!/usr/bin/env node
// Entry point for the wikipedia-trends CLI. Subcommands are added in M4.

function main(argv: string[]): void {
  const [subcommand] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log("wikipedia-trends: subcommands not implemented yet (see MILESTONES.md M4)");
    return;
  }
  console.error(`Unknown subcommand: ${subcommand}`);
  process.exitCode = 1;
}

main(process.argv.slice(2));
