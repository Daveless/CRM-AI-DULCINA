// Sincronización diaria con WooCommerce (sección 7.6 del manual). Trae
// productos publicados, hace upsert por woo_product_id, y desactiva los que
// ya no vienen. Se invoca manualmente (curl/Studio) o por pg_cron en un
// proyecto desplegado (ver README: no se wireó pg_cron en local porque el
// contenedor de Postgres no tiene ruta de red limpia hacia el edge-runtime
// local).
import { serviceClient } from "../_shared/supabase-client.ts";

const supabase = serviceClient();

interface WooProduct {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  stock_quantity: number | null;
  categories: { id: number; name: string }[];
  images: { src: string }[];
  permalink: string;
  status: string;
  date_modified_gmt: string;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function fetchAllProducts(): Promise<WooProduct[]> {
  const siteUrl = env("WOOCOMMERCE_SITE_URL");
  const consumerKey = env("WOOCOMERCE_CONSUMIDOR");
  const consumerSecret = env("WOOCOMERCE_SECRET");

  const products: WooProduct[] = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const url =
      `${siteUrl}/wp-json/wc/v3/products?status=publish&per_page=${perPage}&page=${page}` +
      `&consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`woocommerce_error:${res.status}:${text}`);
    }
    const batch: WooProduct[] = await res.json();
    products.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return products;
}

Deno.serve(async () => {
  const { data: run, error: runInsertError } = await supabase
    .from("catalog_sync_runs")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (runInsertError) {
    return new Response(JSON.stringify({ ok: false, error: String(runInsertError) }), { status: 500 });
  }

  try {
    const wooProducts = await fetchAllProducts();

    const fetchedIds: number[] = [];
    let upserted = 0;

    for (const p of wooProducts) {
      fetchedIds.push(p.id);
      const { error } = await supabase.from("products").upsert(
        {
          woo_product_id: p.id,
          sku: p.sku || null,
          name: p.name,
          description: stripHtml(p.description ?? ""),
          price: parseFloat(p.price || "0"),
          regular_price: p.regular_price ? parseFloat(p.regular_price) : null,
          sale_price: p.sale_price ? parseFloat(p.sale_price) : null,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          occasions: (p.categories ?? []).map((c) => slugify(c.name)),
          image_url: p.images?.[0]?.src ?? null,
          permalink: p.permalink,
          is_active: true,
          woo_modified_at: p.date_modified_gmt ? `${p.date_modified_gmt}Z` : null,
          synced_at: new Date().toISOString(),
          raw: p,
        },
        { onConflict: "woo_product_id" },
      );
      if (error) throw error;
      upserted += 1;
    }

    const { data: deactivated, error: deactivateError } = await supabase
      .from("products")
      .update({ is_active: false, synced_at: new Date().toISOString() })
      .eq("is_active", true)
      .not("woo_product_id", "is", null)
      .not("woo_product_id", "in", `(${fetchedIds.join(",") || "0"})`)
      .select("id");
    if (deactivateError) throw deactivateError;

    await supabase
      .from("catalog_sync_runs")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        fetched: wooProducts.length,
        upserted,
        deactivated: deactivated?.length ?? 0,
      })
      .eq("id", run.id);

    return new Response(
      JSON.stringify({ ok: true, fetched: wooProducts.length, upserted, deactivated: deactivated?.length ?? 0 }),
      { status: 200 },
    );
  } catch (err) {
    await supabase
      .from("catalog_sync_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: String(err) })
      .eq("id", run.id);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
