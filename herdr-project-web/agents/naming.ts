// Naming the places agents work in after their projects: Herdr's
// workspaces and the Herdr app's spaces, keeping a name the user gives
// one afterwards.

import { join } from "node:path";
import type { AppCommand, AppSpace } from "../herdr/app.ts";
import { spaceNames } from "../herdr/app.ts";
import type { Herdr } from "../herdr/backend.ts";
import type { Ask } from "../herdr/tui.ts";
import { projectDir } from "./launch.ts";
import { projectDirs, projectLabels, readReadme, readmeName } from "../project/project.ts";
import { workspacesToName } from "../picker/rows.ts";
import { loadState, saveState } from "../statefile.ts";

/** Reports the title in the front matter of the project in directory to
 * Herdr workspace through tryAsk, for the Spaces panel, if it has one. */
export function reportTitle(tryAsk: Ask, workspace: string, directory: string) {
  const title = projectLabels(directory, readReadme(directory)).title;
  if (title !== "(no title)") return tryAsk("workspace.report_metadata", { workspace_id: workspace, source: "readme-title", tokens: { title } });
}

export type NamerDeps = {
  // Where the names given are kept.
  stateDir: string;
  projectRoot: string;
  // Asks Herdr, returning null if it fails.
  tryAsk: Ask;
  // Returns the Herdr app's spaces.
  spaces: () => Promise<AppSpace[]>;
  // Runs a Herdr app command.
  command: AppCommand;
  onError: (error: unknown) => void;
};

/** Names Herdr's workspaces and the Herdr app's spaces after the projects
 * in projectRoot, keeping what it named in stateDir. */
export class Namer {
  private deps: NamerDeps;
  private namedPath: string;
  // The projects whose workspace has been named, so that a name the user
  // gives one afterwards stays. Those open when this first runs count:
  // their workspaces have their names already.
  private named: Set<string>;
  private spaceNamesPath: string;
  // The names the Herdr app's spaces were last given after their
  // projects, by space, so that a name the user gives a space stays until
  // its project's name changes. Null until the first naming, which takes
  // the spaces open then as named already, as for Herdr's workspaces.
  private spaceNamesGiven: Record<string, string> | null;

  constructor(deps: NamerDeps) {
    this.deps = deps;
    this.namedPath = join(deps.stateDir, "named.json");
    this.named = new Set((loadState(this.namedPath) as string[] | null) ?? projectDirs(deps.projectRoot));
    saveState(this.namedPath, [...this.named]);
    this.spaceNamesPath = join(deps.stateDir, "space-names.json");
    this.spaceNamesGiven = loadState(this.spaceNamesPath) as Record<string, string> | null;
  }

  /** Returns the projects in projectRoot, each with the name its README.md
   * gives it, or null. */
  names(): [string, string | null][] {
    return projectDirs(this.deps.projectRoot).map((dir) => [dir, readmeName(dir)]);
  }

  /** Names agents' workspaces in herdr after their projects, once, as
   * soon as a project has a name, returning whether Herdr renamed each it
   * was asked to. */
  async workspaces(herdr: Herdr | null): Promise<boolean> {
    const { tryAsk, projectRoot } = this.deps;
    let all = true;
    const nameOf = (dir: string) => readmeName(dir) ?? "";
    for (const { dir, workspace, name } of workspacesToName(herdr, this.named, (cwd) => projectDir(cwd, projectRoot), nameOf)) {
      if (!(await tryAsk("workspace.rename", { workspace_id: workspace, label: name }))) {
        all = false;
        continue;
      }
      this.named.add(dir);
      saveState(this.namedPath, [...this.named]);
      await reportTitle(tryAsk, workspace, dir);
    }
    return all;
  }

  /** Names each Herdr app space after its project once its README.md
   * names it, and again when that name changes. */
  async appSpaces() {
    const nameOf = (folder: string) => {
      const dir = projectDir(folder, this.deps.projectRoot);
      return dir && readmeName(dir);
    };
    const spaces = await this.deps.spaces();
    const first = this.spaceNamesGiven === null;
    // Only the spaces there are.
    const given: Record<string, string> = Object.fromEntries(
      Object.entries(this.spaceNamesGiven ?? {}).filter(([id]) => spaces.some((s) => s.id === id)),
    );
    for (const { id, name, rename } of spaceNames(spaces, given, nameOf)) {
      try {
        if (rename && !first) await this.deps.command("space.rename", { id, name });
        given[id] = name;
      } catch (e) {
        this.deps.onError(e);
      }
    }
    if (JSON.stringify(given) !== JSON.stringify(this.spaceNamesGiven)) saveState(this.spaceNamesPath, given);
    this.spaceNamesGiven = given;
  }
}
