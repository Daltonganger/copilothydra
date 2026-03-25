/**
 * CopilotHydra — line-based TUI prompts
 *
 * Phase 5 foundation:
 * - simple numbered select prompt
 * - simple yes/no confirmation prompt
 * - readline based so it stays dependency-free for the first TUI slice
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function selectOne<T extends { label: string; description?: string }>(
  prompt: string,
  options: T[]
): Promise<T | null> {
  if (options.length === 0) {
    return null;
  }

  output.write(`\n${prompt}\n`);
  for (const [index, option] of options.entries()) {
    const description = option.description ? ` — ${option.description}` : "";
    output.write(`  ${index + 1}. ${option.label}${description}\n`);
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`Choose [1-${options.length}] (Enter cancels): `)).trim();
      if (answer === "") {
        return null;
      }

      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) {
        return options[index - 1] ?? null;
      }
    }
  } finally {
    rl.close();
  }
}

export async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`${prompt} [y/N]: `)).trim().toLowerCase();
      if (answer === "" || answer === "n" || answer === "no") {
        return false;
      }
      if (answer === "y" || answer === "yes") {
        return true;
      }
    }
  } finally {
    rl.close();
  }
}

export async function promptText(prompt: string, options?: { defaultValue?: string }): Promise<string | null> {
  const defaultSuffix = options?.defaultValue ? ` [${options.defaultValue}]` : "";
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`${prompt}${defaultSuffix} (Enter cancels): `)).trim();
      if (answer === "") {
        return null;
      }
      return answer;
    }
  } finally {
    rl.close();
  }
}
