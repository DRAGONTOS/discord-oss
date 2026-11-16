import { CollectibleCategory, CollectibleItemType, CollectibleProduct, Collectibles, orbsExclusiveCategory, Snowflake } from "@spacebar/util";

// Discord's Shop since build 673869 reads its Browse tab from /storefront/collections, which nests each category's
// products and their SKUs. These turn the collectibles-categories catalog into that shape. A product's id is its SKU's
// id, since the catalog has no separate product ids, and everything else follows what Discord's endpoint returns.

export const COLLECTIBLES_APPLICATION_ID = "1096190356233670716";

// fields of a catalog category that aren't the collection's own and don't go into its tenant metadata
const CATEGORY_FIELDS = new Set(["sku_id", "name", "summary", "store_listing_id", "products", "unpublished_at", "hero_banner_display_config", "position", "customized"]);
const PRODUCT_LINE_COLLECTIBLES = 7;
const SKU_TYPE_BUNDLE = 4;
const SKU_TYPE_DURABLE = 2;
const SKU_FLAG_AVAILABLE = 4;

const timestamp = (id: string) => {
    try {
        return new Date(Snowflake.timestampOf(id)).toISOString();
    } catch {
        return new Date(0).toISOString();
    }
};

const slug = (name: string) =>
    name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-");

const sku = (product: CollectibleProduct, productId: string, option: { name: string; value: string }, position: number): Record<string, unknown> => {
    const bundle = product.type === CollectibleItemType.BUNDLE;
    return {
        id: product.sku_id,
        type: bundle ? SKU_TYPE_BUNDLE : SKU_TYPE_DURABLE,
        product_line: PRODUCT_LINE_COLLECTIBLES,
        application_id: COLLECTIBLES_APPLICATION_ID,
        name: product.name,
        description: product.summary ?? "",
        flags: SKU_FLAG_AVAILABLE,
        slug: slug(product.name),
        premium: false,
        exclusive: false,
        selected_options: [{ option_name: option.name, option_value: option.value }],
        product_id: productId,
        position,
        hierarchy_order: position,
        thumbnail_asset_id: null,
        ...(product.preview_assets ? { preview_asset_paths: product.preview_assets } : {}),
        tenant_metadata: {
            collectibles: {
                type: product.type,
                premium_type: product.premium_type ?? 0,
                ...(product.type < CollectibleItemType.BUNDLE && product.items[0] ? { item: product.items[0] } : {}),
                option_selector_display_value: product.variant_value ?? null,
                source_type: 1,
                is_first_party: product.is_first_party ?? false,
            },
        },
        prices: product.prices ?? {},
        ...(bundle
            ? {
                  bundled_skus: (product.bundled_products ?? []).map((part) => sku({ ...part, preview_assets: undefined }, part.sku_id, { name: "default", value: "default" }, 0)),
              }
            : {}),
    };
};

const product = (category: CollectibleCategory, entry: CollectibleProduct) => {
    const variants = entry.type === CollectibleItemType.VARIANTS_GROUP ? (entry.variants ?? []) : [];
    const options = variants.length
        ? [{ name: entry.name, option_values: variants.map((variant) => String(variant.variant_label ?? variant.name)) }]
        : [{ name: "default", option_values: ["default"] }];
    const skus = variants.length
        ? variants.map((variant, index) => sku(variant, entry.sku_id, { name: entry.name, value: String(variant.variant_label ?? variant.name) }, index))
        : [sku(entry, entry.sku_id, { name: "default", value: "default" }, 0)];
    return {
        id: entry.sku_id,
        application_id: COLLECTIBLES_APPLICATION_ID,
        sku_ids: skus.map((x) => x.id),
        name: entry.name,
        summary: entry.summary ?? "",
        options,
        created_at: timestamp(entry.sku_id),
        updated_at: timestamp(entry.sku_id),
        tenant_metadata: {
            collectibles: {
                primary_collection_id: category.sku_id,
                primary_collection_styles: entry.styles ?? category.styles ?? null,
                primary_collection_pdp_bg_url: category.pdp_bg_url ?? null,
                primary_collection_will_unpublish_at: entry.unpublished_at ?? null,
                // the catalog gives everything premium_type 2 so it's free to claim, and hide_badge keeps the Nitro badge off
                ...(entry.hide_badge !== undefined ? { hide_badge: entry.hide_badge } : {}),
                ...(entry.badge_override !== undefined ? { badge_override: entry.badge_override } : {}),
            },
        },
        skus,
    };
};

export const storefrontCollection = (category: CollectibleCategory, includeProducts = true) => {
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(category)) if (!CATEGORY_FIELDS.has(key)) metadata[key] = value;
    if (category.hero_banner_display_config !== undefined) metadata.hero_display_config = category.hero_banner_display_config;
    return {
        id: category.sku_id,
        application_id: COLLECTIBLES_APPLICATION_ID,
        name: category.name,
        description: category.summary ?? " ",
        product_ids: category.products.map((x) => x.sku_id),
        created_at: timestamp(category.sku_id),
        updated_at: timestamp(category.sku_id),
        ...(category.unpublished_at ? { unpublish_settings: { will_unpublish_at: category.unpublished_at } } : {}),
        is_orbs_exclusive: orbsExclusiveCategory(category),
        tenant_metadata: { collectibles: metadata },
        products: includeProducts ? category.products.map((entry) => product(category, entry)) : [],
    };
};

/** The listed categories in the Shop's order. Orbs-only ones stay in, flagged by is_orbs_exclusive, as on Discord. */
export const storefrontCategories = async () => (await Collectibles.categories()).filter((category) => category.products.length);
