/**
 * Responsibility: skill node card and the fields shared with the inspector.
 * Inputs: skill node data, discovered skills, and a patch callback.
 * Outputs: a searchable skill picker and a custom path field.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useContext, useState } from "react";
import type { SkillNodeData } from "../graph/types";
import type { SkillSummary } from "../skills/parseSkill";
import { usePatchNode } from "./patch";
import { SkillsContext } from "./skillsContext";
import { cardClass, fieldClass, labelClass } from "./ui";

export function SkillFields({
  data,
  onChange,
  compact = false,
}: {
  data: SkillNodeData;
  onChange: (patch: Partial<SkillNodeData>) => void;
  compact?: boolean;
}) {
  const skills = useContext(SkillsContext);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = skills.filter((skill) => {
    if (!needle) return true;
    return (
      skill.title.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle) ||
      skill.skillPath.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium leading-snug">{data.title || "Skill"}</p>
        <p className={`mt-1 text-[11px] leading-snug text-zinc-500 ${compact ? "line-clamp-3" : ""}`}>
          {data.description || "No description"}
        </p>
      </div>
      <label className={labelClass}>
        Discovered skills
        <input
          className={`${fieldClass} mt-1`}
          value={query}
          placeholder="Search skills"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className={`overflow-auto rounded border border-zinc-200 dark:border-zinc-800 ${compact ? "max-h-24" : "max-h-48"}`}>
        {skills.length === 0 && <li className="px-2 py-1.5 text-[11px] text-zinc-400">No skills discovered</li>}
        {skills.length > 0 && matches.length === 0 && (
          <li className="px-2 py-1.5 text-[11px] text-zinc-400">No matching skills</li>
        )}
        {matches.map((skill) => (
          <li key={skill.skillPath}>
            <button
              type="button"
              className={`nodrag nopan block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                data.source === "discovered" && data.skillPath === skill.skillPath ? "bg-zinc-100 dark:bg-zinc-800" : ""
              }`}
              title={skill.skillPath}
              onClick={() => selectSkill(skill, onChange)}
            >
              {skill.title}
            </button>
          </li>
        ))}
      </ul>
      <label className={labelClass}>
        Custom path
        <input
          className={`${fieldClass} mt-1`}
          value={data.skillPath}
          placeholder="Custom skill path"
          onChange={(event) => {
            const skillPath = event.target.value;
            onChange({
              source: "custom",
              skillPath,
              title: skillPath.trim() ? basename(skillPath) : "Skill",
              description: "",
            });
          }}
        />
      </label>
    </div>
  );
}

function selectSkill(skill: SkillSummary, onChange: (patch: Partial<SkillNodeData>) => void) {
  onChange({
    source: "discovered",
    skillPath: skill.skillPath,
    title: skill.title,
    description: skill.description,
  });
}

function basename(skillPath: string): string {
  const parts = skillPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || skillPath;
}

export function SkillNode({ id, data }: NodeProps<Node<SkillNodeData, "skill">>) {
  const patch = usePatchNode(id);
  return (
    <div className={cardClass}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Skill</p>
      <SkillFields data={data} compact onChange={(next) => patch(next)} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
    </div>
  );
}
