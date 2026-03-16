import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  await initDb();
  const db = getDb();

  const categories = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.color, c.sort_order,
              c.is_active
       FROM categories c
       ORDER BY c.sort_order`
    )
    .all() as {
    id: number;
    slug: string;
    name: string;
    description: string;
    color: string;
    sort_order: number;
    is_active: number;
  }[];

  const subcategories = db
    .prepare(
      `SELECT s.slug, s.name, s.description, s.category_id, s.sort_order,
              s.is_active, s.example_prompts
       FROM subcategories s
       ORDER BY s.sort_order`
    )
    .all() as {
    slug: string;
    name: string;
    description: string;
    category_id: number;
    sort_order: number;
    is_active: number;
    example_prompts: string;
  }[];

  const subsByCategory = new Map<number, typeof subcategories>();
  for (const s of subcategories) {
    const group = subsByCategory.get(s.category_id) ?? [];
    group.push(s);
    subsByCategory.set(s.category_id, group);
  }

  const result = categories.map((cat) => ({
    ...cat,
    subcategories: (subsByCategory.get(cat.id) ?? []).map((s) => ({
      ...s,
      example_prompts: JSON.parse(s.example_prompts),
    })),
  }));

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
