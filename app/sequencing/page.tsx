import { SequencingTool } from "./sequencing-tool";

export const metadata = {
	title: "Sequencing Planner — Ori",
	description: "Plan complete Sanger sequencing coverage for any plasmid. Detects universal primers and fills gaps with custom primer positions.",
};

export default function SequencingPage() {
	return <SequencingTool />;
}
