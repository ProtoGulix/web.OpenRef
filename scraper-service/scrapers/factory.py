from .api_scraper import ApiScraper
from .html_scraper import HtmlScraper
from .browser_scraper import BrowserScraper
from .base import BaseScraper


def make_scraper(source: dict) -> BaseScraper:
    method = source.get("method", "html")
    if method == "api":
        return ApiScraper(source)
    if method == "browser":
        return BrowserScraper(source)
    return HtmlScraper(source)
