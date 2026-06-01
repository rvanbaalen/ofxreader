#!/usr/bin/env node
import { run } from "../src/cli.ts";

process.exitCode = run(process.argv.slice(2));
