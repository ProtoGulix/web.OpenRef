from abc import ABC, abstractmethod


class BaseScraper(ABC):
    def __init__(self, source: dict):
        self.source = source
        self.id = source["id"]
        self.url = source["url"]
        self.devise = source["devise"]
        self.inc_vat = source["inc_vat"]

    @abstractmethod
    async def search(self, ref: str) -> list[dict]:
        """Retourne une liste d'items : {link, price, name, ref, devise, inc_vat, image, manufacturer, source}"""
        ...
