def primary_text_template(product_url: str, product_name: str | None = None, brand_name: str | None = None) -> str:
    brand = brand_name or "Monz Montréal"
    return (
        f"{product_name or 'This product'} — a reminder that you can feel beautiful, confident, and completely yourself.\n\n"
        "For years, I chose what was practical — pieces that suited my day, but never truly felt like me. "
        "Somewhere along the way, style became something I admired from a distance.\n"
        f"Then I discovered {brand}.\n\n"
        "Now, every outfit feels like a reflection of me — soft fabrics that move with ease, shoes that carry me gracefully, "
        "and layers that radiate elegance with every step.\n\n"
        "These aren’t just clothes and footwear. They’re a gentle reminder that you can feel beautiful, confident, and completely yourself.\n\n"
        "Today only — Post Holiday sales are open. Timeless style and comfort, available at exclusive prices for a limited time.\n\n"
        f"Shop now: {product_url}"
    )


def headline_template(product_name: str | None = None) -> str:
    return f"{product_name or 'Post Holiday Sale'}: 60% OFF"


def description_template() -> str:
    return "Free Shipping Today Only"


def build_copy(product_url: str, product_name: str | None = None, brand_name: str | None = None) -> dict:
    return {
        "primary_text": primary_text_template(product_url, product_name, brand_name),
        "headline": headline_template(product_name),
        "description": description_template(),
        "url": product_url,
    }
