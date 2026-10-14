export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date?: string;
  sections: ChangelogSection[];
}

/** Read the release headings and bullet lists used by the project's CHANGELOG.md. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let section: ChangelogSection | undefined;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (heading) {
      release = { version: heading[1], date: heading[2], sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    const category = /^### (.+)$/.exec(line);
    if (release && category) {
      section = { title: category[1].trim(), items: [] };
      release.sections.push(section);
      continue;
    }
    if (!section) continue;
    const bullet = /^- (.+)$/.exec(line);
    if (bullet) section.items.push(bullet[1]);
    else if (/^\s+\S/.test(line) && section.items.length) {
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    }
  }

  return releases.map(entry => ({ ...entry, sections: entry.sections.filter(group => group.items.length) }))
    .filter(entry => entry.sections.length);
}
