import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

function parseFrontmatter(content) {
  const meta = { name: '', description: '' };
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (match) {
    const yamlText = match[1];
    yamlText.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join(':').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1).trim();
        }
        if (key === 'name') meta.name = val;
        if (key === 'description') meta.description = val;
      }
    });
  }
  return meta;
}

export const SkillsPlugin = {
  name: 'SkillsPlugin',
  
  async preLLM(context) {
    const { executor } = context;
    if (executor.features?.enable_skills === false) return;
    const skills = executor.skills || [];
    if (skills.length === 0) return;

    const SKILLS_DIR = path.join(process.cwd(), 'skills');
    const includeGlobal = executor.features?.enable_global_skills === true;
    const richSkills = [];

    for (const skillId of skills) {
      let skillDir = path.join(SKILLS_DIR, skillId);
      let skillMdPath = path.join(skillDir, 'SKILL.md');
      let isGlobal = false;
      let exists = await fs.access(skillMdPath).then(() => true).catch(() => false);

      if (!exists && includeGlobal) {
        skillDir = path.join(os.homedir(), '.agents', 'skills', skillId);
        skillMdPath = path.join(skillDir, 'SKILL.md');
        exists = await fs.access(skillMdPath).then(() => true).catch(() => false);
        isGlobal = true;
      }

      if (exists) {
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const meta = parseFrontmatter(content);
          const description = meta.description || 'Professional skill description';
          const file = isGlobal ? skillMdPath : path.relative(process.cwd(), skillMdPath);

          richSkills.push({ id: skillId, description, file });
        } catch (e) {
          richSkills.push({
            id: skillId,
            description: 'Professional skill description',
            file: `skills/${skillId}/SKILL.md`
          });
        }
      } else {
        richSkills.push({
          id: skillId,
          description: 'Professional skill description',
          file: `skills/${skillId}/SKILL.md`
        });
      }
    }

    if (richSkills.length > 0) {
      const skillsPrompt = `\n\n<available_skills>\nThe following professional skills (Skills) are available in the current session. If you need to perform complex tasks related to these skills, you must use the \`read_file\` tool to read the corresponding \`SKILL.md\` guide to acquire precise domain knowledge and constraints:\n\n${richSkills.map(s => {
        return `- **${s.id}** (read \`${s.file}\` to activate): ${s.description}`;
      }).join('\n')}\n</available_skills>`;
      
      context.systemPrompt += skillsPrompt;
    }
  }
};
