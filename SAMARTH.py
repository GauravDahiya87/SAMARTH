import html as HtmlLib
import io
import json
import math
import os
import re
import threading
import webbrowser
from datetime import datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request, render_template

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:
    TfidfVectorizer = None
    cosine_similarity = None



MIN_LOAN_LIMIT = 1000

Application = Flask(__name__)

Application.config["APP_NAME"] = "EAI"
Application.config["JSON_SORT_KEYS"] = False



GOOGLE_TRANSLATE_API_KEY = os.environ.get("GOOGLE_TRANSLATE_API_KEY")

GOOGLE_TRANSLATE_URL = (
    "https://translation.googleapis.com/language/translate/v2"
)

GOOGLE_LANGUAGES_URL = GOOGLE_TRANSLATE_URL + "/languages"


GOOGLE_LANGUAGE_CODE_MAP = {
    "kok": "gom",
    "mni": "mni-Mtei",
}


GOOGLE_FALLBACK_LANGUAGES = {
    "hi", "as", "bn", "doi", "gu", "kn", "gom", "mai", "ml",
    "mni-Mtei", "mr", "ne", "or", "pa", "sa", "sd", "ta", "te", "ur",
}

TRANSLATIONS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "translations",
)



_GoogleLanguagesCache = {"codes": None}
_GoogleLanguagesLock = threading.Lock()



_UiStringsCache = {}
_UiStringsCacheLock = threading.Lock()


def LoadTranslationSourceFile(FileName):
    Path = os.path.join(TRANSLATIONS_DIR, FileName)
    with open(Path, encoding="utf-8") as File:
        return json.load(File)


class GoogleTranslateError(Exception):
    pass


def GoogleHeaders():
    if not GOOGLE_TRANSLATE_API_KEY:
        raise GoogleTranslateError(
            "Google Translate API key is not configured."
        )



    return {
        "x-goog-api-key": GOOGLE_TRANSLATE_API_KEY,
        "Content-Type": "application/json",
    }


def GoogleLanguageCode(Lang):
    return GOOGLE_LANGUAGE_CODE_MAP.get(Lang, Lang)


def GoogleGetSupportedCodes():
    with _GoogleLanguagesLock:
        Cached = _GoogleLanguagesCache["codes"]
    if Cached is not None:
        return Cached

    try:
        Response = requests.get(
            GOOGLE_LANGUAGES_URL,
            headers=GoogleHeaders(),
            params={"target": "en"},
            timeout=15,
        )
        Response.raise_for_status()
        Codes = {
            Item["language"]
            for Item in Response.json()["data"]["languages"]
        }
    except Exception:

        return set(GOOGLE_FALLBACK_LANGUAGES)

    with _GoogleLanguagesLock:
        _GoogleLanguagesCache["codes"] = Codes

    return Codes


def GoogleTranslateBatch(Texts, Lang, BatchSize=50):
    Target = GoogleLanguageCode(Lang)
    Results = list(Texts)

    Groups = {"html": [], "text": []}
    for Index, Text in enumerate(Texts):
        if not str(Text).strip():
            continue
        Groups["html" if "<" in Text else "text"].append(Index)

    for Format, Indexes in Groups.items():
        for Start in range(0, len(Indexes), BatchSize):
            Chunk = Indexes[Start:Start + BatchSize]

            Response = requests.post(
                GOOGLE_TRANSLATE_URL,
                headers=GoogleHeaders(),
                json={
                    "q": [Texts[Index] for Index in Chunk],
                    "source": "en",
                    "target": Target,
                    "format": Format,
                },
                timeout=30,
            )

            if Response.status_code != 200:
                raise GoogleTranslateError(
                    "Google Translate returned HTTP "
                    f"{Response.status_code}."
                )

            Items = Response.json()["data"]["translations"]

            for Index, Item in zip(Chunk, Items):
                Value = Item["translatedText"]
                if Format == "text":
                    Value = HtmlLib.unescape(Value)
                Results[Index] = Value

    return Results


def TranslationSupportsLanguage(Lang):
    return GoogleLanguageCode(Lang) in GoogleGetSupportedCodes()


def BuildUiStringsForLanguage(Lang):
    TranslateSource = LoadTranslationSourceFile("translate.json")
    TransliterateSource = LoadTranslationSourceFile("transliterate.json")

    Combined = dict(TranslateSource)
    Combined.update(TransliterateSource)

    Unique = list(dict.fromkeys(Combined.values()))
    Translated = dict(
        zip(Unique, GoogleTranslateBatch(Unique, Lang))
    )

    return {
        Key: Translated[Value]
        for Key, Value in Combined.items()
    }



SchemesCache = []
PartnersCache = []

LastSchemeSync = None
LastPartnerSync = None



GovernmentRequestTimeout = 25

GovernmentHeaders = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/142.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

GovernmentSources = {
    "NSFDC": {
        "name": (
            "National Scheduled Castes Finance and "
            "Development Corporation"
        ),
        "base_url": "https://nsfdc.nic.in/",
        "seed_urls": [
            "https://nsfdc.nic.in/",
            "https://nsfdc.nic.in/faqs",
            "https://nsfdc.nic.in/information-disclosed-on-own-initiative",
        ],
        "allowed_domains": ["nsfdc.nic.in"],
    },

    "MYSCHEME": {
        "name": "myScheme Government of India",
        "base_url": "https://www.myscheme.gov.in/",
        "seed_urls": [
            "https://www.myscheme.gov.in/",
            "https://search.myscheme.gov.in/",
            "https://www.myscheme.gov.in/about",
            "https://www.myscheme.gov.in/faqs",
        ],
        "allowed_domains": [
            "myscheme.gov.in",
            "search.myscheme.gov.in",
        ],
    },

    "INDIA_GOV": {
        "name": "National Portal of India",
        "base_url": "https://www.india.gov.in/",
        "seed_urls": [
            "https://www.india.gov.in/my-government/schemes",
            (
                "https://www.india.gov.in/category/"
                "benefits-social-development/subcategory/"
                "minorities-castes-tribes/details/"
                "scheduled-caste-welfare-division-of-ministry-of-"
                "social-justice-and-empowerment"
            ),
        ],
        "allowed_domains": ["india.gov.in"],
    },

    "SOCIAL_JUSTICE": {
        "name": "Ministry of Social Justice and Empowerment",
        "base_url": "https://socialjustice.gov.in/",
        "seed_urls": [
            "https://socialjustice.gov.in/",
            "https://socialjustice.gov.in/schemes/27",
            "https://socialjustice.gov.in/schemes/28",
        ],
        "allowed_domains": ["socialjustice.gov.in"],
    },
}


GovernmentDocumentExtensions = (
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
)

GovernmentSchemeKeywords = [
    "scheme",
    "schemes",
    "loan",
    "finance",
    "financial",
    "credit",
    "micro finance",
    "microfinance",
    "term loan",
    "education loan",
    "educational loan",
    "self employment",
    "entrepreneur",
    "entrepreneurship",
    "scheduled caste",
    "scheduled castes",
    "welfare",
    "subsidy",
    "skill development",
    "livelihood",
    "scholarship",
    "scholarships",
    "top class education",
    "overseas scholarship",
]



def GovernmentCreateSession():
    Session = requests.Session()
    Session.headers.update(GovernmentHeaders)
    return Session


def GovernmentIsAllowedDomain(Url, AllowedDomains):
    try:
        Hostname = urlparse(Url).hostname

        if not Hostname:
            return False

        Hostname = Hostname.lower()

        for Domain in AllowedDomains:
            Domain = Domain.lower()

            if (
                Hostname == Domain
                or Hostname.endswith("." + Domain)
            ):
                return True

        return False

    except Exception:
        return False


def GovernmentIsDocumentUrl(Url):
    CleanUrl = (
        str(Url)
        .lower()
        .split("?")[0]
        .split("#")[0]
    )

    return CleanUrl.endswith(GovernmentDocumentExtensions)


def GovernmentIsSchemeRelated(Text):
    Text = str(Text or "").lower()

    return any(
        Keyword in Text
        for Keyword in GovernmentSchemeKeywords
    )


def GovernmentCleanText(Text):
    return " ".join(str(Text or "").split())


def GovernmentFetchUrl(Url):
    Session = GovernmentCreateSession()

    try:
        Response = Session.get(
            Url,
            timeout=GovernmentRequestTimeout,
            allow_redirects=True,
        )

        Response.raise_for_status()

        return {
            "success": True,
            "url": Response.url,
            "status_code": Response.status_code,
            "content": Response.text,
            "content_type": Response.headers.get(
                "Content-Type",
                "",
            ),
            "fetched_at": datetime.now().isoformat(),
        }

    except requests.RequestException as Error:
        return {
            "success": False,
            "url": Url,
            "status_code": None,
            "content": "",
            "content_type": "",
            "error": str(Error),
            "fetched_at": datetime.now().isoformat(),
        }


def GovernmentExtractPageContent(
    Html,
    Url,
    AllowedDomains,
):
    Soup = BeautifulSoup(Html, "html.parser")

    for Element in Soup(
        ["script", "style", "noscript", "svg"]
    ):
        Element.decompose()

    Title = ""

    if Soup.title:
        Title = GovernmentCleanText(
            Soup.title.get_text(
                " ",
                strip=True,
            )
        )

    Headings = []

    for Heading in Soup.find_all(
        ["h1", "h2", "h3", "h4", "h5"]
    ):
        Text = GovernmentCleanText(
            Heading.get_text(
                " ",
                strip=True,
            )
        )

        if Text:
            Headings.append(Text)

    Paragraphs = []

    for Paragraph in Soup.find_all("p"):
        Text = GovernmentCleanText(
            Paragraph.get_text(
                " ",
                strip=True,
            )
        )

        if Text:
            Paragraphs.append(Text)

    Links = []
    Seen = set()

    for Anchor in Soup.find_all(
        "a",
        href=True,
    ):
        Href = Anchor.get(
            "href",
            "",
        ).strip()

        if not Href:
            continue

        AbsoluteUrl = urljoin(
            Url,
            Href,
        )

        if not AbsoluteUrl.startswith(
            ("http://", "https://")
        ):
            continue

        if not GovernmentIsAllowedDomain(
            AbsoluteUrl,
            AllowedDomains,
        ):
            continue

        if AbsoluteUrl in Seen:
            continue

        Seen.add(AbsoluteUrl)

        Text = GovernmentCleanText(
            Anchor.get_text(
                " ",
                strip=True,
            )
        )

        Links.append(
            {
                "text": Text,
                "url": AbsoluteUrl,
                "is_document": GovernmentIsDocumentUrl(
                    AbsoluteUrl
                ),
                "scheme_related": GovernmentIsSchemeRelated(
                    Text + " " + AbsoluteUrl
                ),
            }
        )

    return {
        "title": Title,
        "headings": Headings,
        "paragraphs": Paragraphs,
        "links": Links,
        "url": Url,
    }


def GovernmentFetchGovernmentPage(
    Url,
    AllowedDomains,
):
    Result = GovernmentFetchUrl(Url)

    if not Result["success"]:
        return Result

    ContentType = Result.get(
        "content_type",
        "",
    ).lower()

    if "text/html" not in ContentType:
        return {
            "success": True,
            "source_url": Result["url"],
            "status_code": Result["status_code"],
            "content_type": Result["content_type"],
            "fetched_at": Result["fetched_at"],
            "document": True,
        }

    Page = GovernmentExtractPageContent(
        Result["content"],
        Result["url"],
        AllowedDomains,
    )

    return {
        "success": True,
        "source_url": Result["url"],
        "status_code": Result["status_code"],
        "content_type": Result["content_type"],
        "fetched_at": Result["fetched_at"],
        "title": Page["title"],
        "headings": Page["headings"],
        "paragraphs": Page["paragraphs"],
        "links": Page["links"],
    }



def GovernmentExtractNsfdcLiveSchemes():
    Url = "https://nsfdc.nic.in/scheme"

    Result = GovernmentFetchUrl(Url)

    if not Result.get("success"):
        return []

    try:
        Soup = BeautifulSoup(
            Result["content"],
            "html.parser",
        )

        SchemeHeadings = []

        for Heading in Soup.find_all(["h2", "h3"]):
            HeadingText = GovernmentCleanText(
                Heading.get_text(" ", strip=True)
            )

            if re.match(r"^\d+\s+", HeadingText):
                SchemeHeadings.append(Heading)

        if not SchemeHeadings:
            return []

        Schemes = []

        for Index, Heading in enumerate(SchemeHeadings):
            Name = GovernmentCleanText(
                Heading.get_text(" ", strip=True)
            )

            Name = re.sub(
                r"^\d+\s+",
                "",
                Name,
            ).strip()

            NextHeading = (
                SchemeHeadings[Index + 1]
                if Index + 1 < len(SchemeHeadings)
                else None
            )


            Elements = []
            SeenTexts = set()
            Current = Heading

            while True:
                Current = Current.find_next()

                if Current is None or Current == NextHeading:
                    break

                if Current.name not in [
                    "p",
                    "li",
                    "td",
                    "h4",
                    "h5",
                ]:
                    continue

                CurrentText = GovernmentCleanText(
                    Current.get_text(" ", strip=True)
                )

                if not CurrentText or CurrentText in SeenTexts:
                    continue

                SeenTexts.add(CurrentText)
                Elements.append(CurrentText)

            FullText = GovernmentCleanText(
                " ".join(Elements)
            )

            if not FullText:
                continue


            MaxLoan = ""

            LoanMatch = re.search(
                r"Maximum\s+Loan\s+Limit\s*"
                r"(.*?)(?=Rate\s+of\s+Interest|"
                r"Repayment\s+Period|$)",
                FullText,
                re.IGNORECASE,
            )

            if LoanMatch:
                LoanText = GovernmentCleanText(
                    LoanMatch.group(1)
                )

                AmountMatches = re.findall(
                    r"(?:₹|Rs\.?|INR)\s*"
                    r"[\d,]+(?:\.\d+)?\s*"
                    r"(?:lakh|lakhs|lac|lacs|crore|crores)?",
                    LoanText,
                    re.IGNORECASE,
                )

                if AmountMatches:
                    MaxLoan = AmountMatches[-1].strip()



            if not MaxLoan:
                AmountMatches = re.findall(
                    r"(?:₹|Rs\.?|INR)\s*"
                    r"[\d,]+(?:\.\d+)?\s*"
                    r"(?:lakh|lakhs|lac|lacs|crore|crores)?",
                    FullText,
                    re.IGNORECASE,
                )

                if AmountMatches:
                    MaxLoan = AmountMatches[-1].strip()

            InterestRate = ""

            InterestMatch = re.search(
                r"Rate\s+of\s+Interest\s*"
                r"(.*?)(?=Repayment\s+Period|$)",
                FullText,
                re.IGNORECASE,
            )

            if InterestMatch:
                Percentages = re.findall(
                    r"\d+(?:\.\d+)?\s*%",
                    InterestMatch.group(1),
                )

                UniquePercentages = []

                for Percentage in Percentages:
                    Percentage = Percentage.strip()

                    if Percentage not in UniquePercentages:
                        UniquePercentages.append(Percentage)

                InterestRate = " / ".join(
                    UniquePercentages
                )

            Repayment = ""

            RepaymentMatch = re.search(
                r"Repayment\s+Period\s*"
                r"(.*?)(?=Recognized\s+Professional|$)",
                FullText,
                re.IGNORECASE,
            )

            if RepaymentMatch:
                RepaymentText = GovernmentCleanText(
                    RepaymentMatch.group(1)
                )

                YearMatches = re.findall(
                    r"(\d+(?:\.\d+)?)\s*years?",
                    RepaymentText,
                    re.IGNORECASE,
                )

                if YearMatches:
                    Repayment = (
                        YearMatches[0]
                        + " years"
                    )
                else:
                    Repayment = RepaymentText


            ParserText = GovernmentCleanText(
                FullText
                + " Maximum Loan Limit "
                + MaxLoan
                + " Rate of Interest "
                + InterestRate
                + " Repayment Period "
                + Repayment
            )

            Schemes.append(
                {
                    "source_id": "NSFDC",
                    "source_name": GovernmentSources[
                        "NSFDC"
                    ]["name"],
                    "url": Url,
                    "type": "webpage",
                    "title": Name,
                    "fetched_at": Result["fetched_at"],
                    "data": {
                        "success": True,
                        "source_url": Result["url"],
                        "status_code": Result[
                            "status_code"
                        ],
                        "content_type": Result[
                            "content_type"
                        ],
                        "fetched_at": Result[
                            "fetched_at"
                        ],
                        "title": Name,
                        "headings": [Name],
                        "paragraphs": [ParserText],
                        "links": [],
                    },
                }
            )

        return Schemes

    except Exception:
        return []

def GovernmentDiscoverSourceLinks(SourceId):
    Source = GovernmentSources[SourceId]

    DiscoveredPages = []
    DiscoveredDocuments = []

    SeenPages = set()
    SeenDocuments = set()

    for SeedUrl in Source["seed_urls"]:

        Result = GovernmentFetchGovernmentPage(
            SeedUrl,
            Source["allowed_domains"],
        )

        if not Result.get("success"):
            continue

        if GovernmentIsSchemeRelated(
            SeedUrl
            + " "
            + Result.get("title", "")
        ):
            DiscoveredPages.append(
                {
                    "source_id": SourceId,
                    "source_name": Source["name"],
                    "url": SeedUrl,
                    "title": Result.get(
                        "title",
                        "",
                    ),
                    "scheme_related": True,
                }
            )

        for Link in Result.get(
            "links",
            [],
        ):

            Url = Link["url"]

            if Link["is_document"]:

                if Url not in SeenDocuments:
                    SeenDocuments.add(Url)

                    DiscoveredDocuments.append(
                        {
                            "source_id": SourceId,
                            "source_name": Source["name"],
                            "url": Url,
                            "title": Link["text"],
                            "scheme_related": Link[
                                "scheme_related"
                            ],
                        }
                    )

            elif Link["scheme_related"]:

                if Url not in SeenPages:
                    SeenPages.add(Url)

                    DiscoveredPages.append(
                        {
                            "source_id": SourceId,
                            "source_name": Source["name"],
                            "url": Url,
                            "title": Link["text"],
                            "scheme_related": True,
                        }
                    )

    return {
        "pages": DiscoveredPages,
        "documents": DiscoveredDocuments,
    }


def GovernmentDiscoverAllGovernmentLinks():
    Result = {}

    for SourceId in GovernmentSources:
        Result[SourceId] = (
            GovernmentDiscoverSourceLinks(
                SourceId
            )
        )

    return Result


def GovernmentCollectSchemeUrls():
    Discovered = (
        GovernmentDiscoverAllGovernmentLinks()
    )

    SchemeUrls = []

    for SourceId, Data in Discovered.items():

        for Page in Data["pages"]:
            SchemeUrls.append(
                {
                    "source_id": SourceId,
                    "source_name": Page[
                        "source_name"
                    ],
                    "url": Page["url"],
                    "type": "webpage",
                    "title": Page["title"],
                }
            )

        for Document in Data["documents"]:

            if Document["scheme_related"]:
                SchemeUrls.append(
                    {
                        "source_id": SourceId,
                        "source_name": Document[
                            "source_name"
                        ],
                        "url": Document["url"],
                        "type": "document",
                        "title": Document["title"],
                    }
                )

    Unique = {}

    for Item in SchemeUrls:
        Unique[Item["url"]] = Item

    return list(Unique.values())


def GovernmentFetchLiveSchemeSources():
    Results = []

    NsfdcSchemes = (
        GovernmentExtractNsfdcLiveSchemes()
    )

    Results.extend(NsfdcSchemes)

    SchemeUrls = (
        GovernmentCollectSchemeUrls()
    )

    AlreadyUsed = {
        Item["url"]
        for Item in NsfdcSchemes
    }

    for Item in SchemeUrls:

        if Item["url"] in AlreadyUsed:
            continue

        Source = GovernmentSources[
            Item["source_id"]
        ]

        Data = GovernmentFetchGovernmentPage(
            Item["url"],
            Source["allowed_domains"],
        )

        if not Data.get("success"):
            continue

        Results.append(
            {
                "source_id": Item["source_id"],
                "source_name": Item["source_name"],
                "url": Item["url"],
                "type": Item["type"],
                "title": Item["title"],
                "fetched_at": datetime.now().isoformat(),
                "data": Data,
            }
        )

    return Results


def GovernmentGetLiveSourceStatus():
    Status = []

    for SourceId, Source in GovernmentSources.items():

        Online = False

        for Url in Source["seed_urls"]:

            Result = GovernmentFetchUrl(Url)

            if Result["success"]:
                Online = True
                break

        Status.append(
            {
                "source_id": SourceId,
                "source_name": Source["name"],
                "online": Online,
                "checked_at": datetime.now().isoformat(),
            }
        )

    return Status



SchemeParserRequestTimeout = 25

SchemeParserHeaders = GovernmentHeaders.copy()

SchemeParserSchemeKeywords = [
    "scheme",
    "loan",
    "finance",
    "financial assistance",
    "credit",
    "micro finance",
    "microfinance",
    "term loan",
    "education loan",
    "educational loan",
    "self employment",
    "entrepreneur",
    "entrepreneurship",
    "scheduled caste",
    "scheduled castes",
    "sc beneficiary",
    "livelihood",
    "skill development",
]

SchemeParserEducationKeywords = [
    "education loan",
    "educational loan",
    "higher education",
    "professional course",
    "technical education",
    "college",
    "university",
    "students",
    "student loan",
]

SchemeParserBusinessKeywords = [
    "term loan",
    "micro finance",
    "microfinance",
    "self employment",
    "business",
    "enterprise",
    "entrepreneur",
    "entrepreneurship",
    "project",
    "commercial activity",
    "income generating activity",
]


def SchemeParserCleanText(Text):
    if not Text:
        return ""

    return " ".join(
        str(Text).split()
    )


def SchemeParserDownloadDocument(Url):
    try:
        Response = requests.get(
            Url,
            headers=SchemeParserHeaders,
            timeout=SchemeParserRequestTimeout,
        )

        Response.raise_for_status()

        return {
            "success": True,
            "content": Response.content,
            "content_type": Response.headers.get(
                "Content-Type",
                "",
            ),
            "url": Response.url,
        }

    except requests.RequestException as Error:

        return {
            "success": False,
            "content": b"",
            "content_type": "",
            "url": Url,
            "error": str(Error),
        }


def SchemeParserExtractPdfText(Content):
    if pdfplumber is None:
        return ""

    try:
        TextParts = []

        with pdfplumber.open(
            io.BytesIO(Content)
        ) as Pdf:

            for Page in Pdf.pages:

                PageText = Page.extract_text()

                if PageText:
                    TextParts.append(
                        PageText
                    )

        return SchemeParserCleanText(
            "\n".join(TextParts)
        )

    except Exception:
        return ""


def SchemeParserExtractHtmlText(Content):
    try:
        Soup = BeautifulSoup(
            Content,
            "html.parser",
        )

        for Element in Soup(
            [
                "script",
                "style",
                "noscript",
                "svg",
            ]
        ):
            Element.decompose()

        return SchemeParserCleanText(
            Soup.get_text(
                " ",
                strip=True,
            )
        )

    except Exception:
        return ""


def SchemeParserGetSourceText(Source):
    Data = Source.get(
        "data",
        {},
    )

    if not Data.get("success"):
        return ""

    if Data.get("document"):

        Url = Source.get(
            "url",
            "",
        )

        Downloaded = (
            SchemeParserDownloadDocument(
                Url
            )
        )

        if not Downloaded["success"]:
            return ""

        ContentType = (
            Downloaded.get(
                "content_type",
                "",
            ).lower()
        )

        if (
            "pdf" in ContentType
            or str(Url).lower().split("?")[0].endswith(
                ".pdf"
            )
        ):
            return SchemeParserExtractPdfText(
                Downloaded["content"]
            )

        return ""

    Paragraphs = Data.get(
        "paragraphs",
        [],
    )

    Headings = Data.get(
        "headings",
        [],
    )

    return SchemeParserCleanText(
        " ".join(
            Headings + Paragraphs
        )
    )



def SchemeParserFindIncomeLimit(Text):
    Patterns = [
        r"(?:annual|yearly|family)\s+(?:family\s+)?income.{0,100}?(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lakhs|lac|lacs)",
        r"income\s+limit.{0,100}?(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lakhs|lac|lacs)",
        r"family\s+income.{0,100}?(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lakhs|lac|lacs)",
        r"(?:rs\.?|₹|inr)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lakhs|lac|lacs).{0,100}?income",
    ]

    for Pattern in Patterns:

        Match = re.search(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        if Match:

            try:
                Value = float(
                    Match.group(1)
                )

                return Value * 100000

            except ValueError:
                pass

    return None


def SchemeParserFindAmounts(Text):
    Amounts = []

    Patterns = [
        r"(?:₹|rs\.?|rs)\s*([0-9]+(?:\.[0-9]+)?)\s*(crore|crores|lakh|lakhs|lac|lacs|million|thousand)?",
        r"([0-9]+(?:\.[0-9]+)?)\s*(crore|crores|lakh|lakhs|lac|lacs|million|thousand)",
    ]

    for Pattern in Patterns:

        Matches = re.findall(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        for Value, Unit in Matches:

            try:
                Number = float(Value)
            except ValueError:
                continue

            Unit = Unit.lower().strip()

            if Unit in ["crore", "crores"]:
                Amount = Number * 10000000

            elif Unit in [
                "lakh",
                "lakhs",
                "lac",
                "lacs",
            ]:
                Amount = Number * 100000

            elif Unit == "million":
                Amount = Number * 1000000

            elif Unit == "thousand":
                Amount = Number * 1000

            else:
                Amount = Number

            Amounts.append(Amount)

    return sorted(set(Amounts))


def SchemeParserFindLoanLimit(Text):
    Patterns = [
        r"(?:loan|financial assistance|finance).{0,120}?(?:up to|upto|maximum|limit|ceiling).{0,80}?(?:₹|rs\.?|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(lakh|lakhs|lac|lacs|crore|crores)",
        r"(?:up to|upto|maximum).{0,80}?(?:₹|rs\.?|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(lakh|lakhs|lac|lacs|crore|crores).{0,80}?(?:loan|finance)",
    ]

    for Pattern in Patterns:

        Match = re.search(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        if Match:

            Value = float(
                Match.group(1)
            )

            Unit = Match.group(2).lower()

            if Unit in [
                "lakh",
                "lakhs",
                "lac",
                "lacs",
            ]:
                return Value * 100000

            if Unit in [
                "crore",
                "crores",
            ]:
                return Value * 10000000

    Amounts = SchemeParserFindAmounts(
        Text
    )

    if Amounts:
        return max(Amounts)

    return None


def SchemeParserFindInterestRates(Text):
    Rates = []

    Patterns = [
        r"([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:per\s+annum|p\.?a\.?|interest)",
        r"(?:interest\s+rate|rate\s+of\s+interest).{0,60}?([0-9]+(?:\.[0-9]+)?)\s*%",
        r"([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:to|-)\s*([0-9]+(?:\.[0-9]+)?)\s*%",
    ]

    for Pattern in Patterns:

        Matches = re.findall(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        for Match in Matches:

            if isinstance(
                Match,
                tuple,
            ):

                for Value in Match:

                    try:
                        Rates.append(
                            float(Value)
                        )
                    except ValueError:
                        pass

            else:

                try:
                    Rates.append(
                        float(Match)
                    )
                except ValueError:
                    pass

    Rates = [
        Rate
        for Rate in Rates
        if 0 < Rate <= 50
    ]

    return sorted(set(Rates))


def SchemeParserFindRepaymentPeriod(Text):
    Patterns = [
        r"(?:repayment|repay|tenure).{0,100}?([0-9]+)\s*(?:years?|yrs?)",
        r"([0-9]+)\s*(?:years?|yrs?).{0,100}?(?:repayment|repay|tenure)",
        r"(?:repayment|repay).{0,100}?([0-9]+)\s*(?:months?|month)",
    ]

    for Pattern in Patterns:

        Match = re.search(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        if Match:

            Value = int(
                Match.group(1)
            )

            if "month" in Pattern:
                return Value / 12

            return Value

    return None


def SchemeParserFindMoratorium(Text):
    Patterns = [
        r"(?:moratorium|moratoriam).{0,100}?([0-9]+)\s*(?:months?|month)",
        r"([0-9]+)\s*(?:months?|month).{0,100}?(?:moratorium|moratoriam)",
    ]

    Values = []

    for Pattern in Patterns:

        Matches = re.findall(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        for Value in Matches:

            try:
                Values.append(
                    int(Value)
                )
            except ValueError:
                pass

    if Values:
        return max(Values)

    return None


def SchemeParserFindProjectCost(Text):
    Patterns = [
        r"(?:project\s+cost|cost\s+of\s+project).{0,100}?(?:₹|rs\.?|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(lakh|lakhs|lac|lacs|crore|crores)",
        r"(?:project).{0,100}?(?:up to|upto).{0,50}?(?:₹|rs\.?|inr)?\s*([0-9]+(?:\.[0-9]+)?)\s*(lakh|lakhs|lac|lacs|crore|crores)",
    ]

    for Pattern in Patterns:

        Match = re.search(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        if Match:

            Value = float(
                Match.group(1)
            )

            Unit = Match.group(2).lower()

            if Unit in [
                "lakh",
                "lakhs",
                "lac",
                "lacs",
            ]:
                return Value * 100000

            if Unit in [
                "crore",
                "crores",
            ]:
                return Value * 10000000

    return None


def SchemeParserDetectEducationScheme(Text):
    TextLower = Text.lower()

    return any(
        Keyword in TextLower
        for Keyword in SchemeParserEducationKeywords
    )


def SchemeParserDetectBusinessScheme(Text):
    TextLower = Text.lower()

    return any(
        Keyword in TextLower
        for Keyword in SchemeParserBusinessKeywords
    )


def SchemeParserDetectScScheme(Text):
    TextLower = Text.lower()

    Keywords = [
        "scheduled caste",
        "scheduled castes",
        "sc beneficiary",
        "sc beneficiaries",
        "nsfdc",
        "dalit",
        "social justice",
    ]

    return any(
        Keyword in TextLower
        for Keyword in Keywords
    )


def SchemeParserCalculateSchemeRelevance(Text):
    TextLower = Text.lower()

    Score = 0

    for Keyword in SchemeParserSchemeKeywords:

        if Keyword in TextLower:
            Score += 1

    return Score


def SchemeParserExtractSchemeName(
    Text,
    Title="",
):
    if Title:

        Title = SchemeParserCleanText(
            Title
        )

        if len(Title) <= 200:
            return Title

    Patterns = [
        r"(?:scheme\s*[:\-]\s*)([A-Za-z0-9 &\-\(\)]+)",
        r"(?:under\s+the\s+)([A-Za-z0-9 &\-\(\)]+)\s+(?:scheme)",
        r"([A-Za-z0-9 &\-]+)\s+(?:Micro Finance Scheme)",
        r"([A-Za-z0-9 &\-]+)\s+(?:Term Loan Scheme)",
        r"([A-Za-z0-9 &\-]+)\s+(?:Education Loan Scheme)",
    ]

    for Pattern in Patterns:

        Match = re.search(
            Pattern,
            Text,
            re.IGNORECASE,
        )

        if Match:

            Name = SchemeParserCleanText(
                Match.group(1)
            )

            if len(Name) > 5:
                return Name

    return "Government Scheme"


def SchemeParserExtractEligibility(Text):
    Sentences = re.split(
        r"(?<=[.!?])\s+",
        Text,
    )

    Relevant = []

    EligibilityKeywords = [
        "eligible",
        "eligibility",
        "beneficiary",
        "income",
        "scheduled caste",
        "sc",
        "age",
        "family income",
        "annual income",
        "resident",
        "domicile",
        "education",
        "student",
    ]

    for Sentence in Sentences:

        Sentence = SchemeParserCleanText(
            Sentence
        )

        if len(Sentence) < 20:
            continue

        if any(
            Keyword in Sentence.lower()
            for Keyword in EligibilityKeywords
        ):
            Relevant.append(Sentence)

    return Relevant[:15]


def SchemeParserDetermineSchemeType(Text):
    Education = SchemeParserDetectEducationScheme(
        Text
    )

    Business = SchemeParserDetectBusinessScheme(
        Text
    )

    if Education and Business:
        return "Education and Enterprise"

    if Education:
        return "Education Loan"

    if Business:
        return "Enterprise / Credit"

    return "Financial Assistance"


def SchemeParserParseScheme(Source):
    Text = SchemeParserGetSourceText(
        Source
    )

    if not Text:
        return None

    Relevance = (
        SchemeParserCalculateSchemeRelevance(
            Text
        )
    )

    if Relevance == 0:
        return None

    Title = Source.get(
        "title",
        "",
    )

    if not Title:
        Data = Source.get(
            "data",
            {},
        )

        Title = Data.get(
            "title",
            "",
        )

    return {
        "scheme_name": SchemeParserExtractSchemeName(
            Text,
            Title,
        ),
        "scheme_type": SchemeParserDetermineSchemeType(
            Text
        ),
        "is_sc_scheme": SchemeParserDetectScScheme(
            Text
        ),
        "is_education_scheme": SchemeParserDetectEducationScheme(
            Text
        ),
        "is_business_scheme": SchemeParserDetectBusinessScheme(
            Text
        ),
        "income_limit": SchemeParserFindIncomeLimit(
            Text
        ),
        "loan_limit": SchemeParserFindLoanLimit(
            Text
        ),
        "project_cost_limit": SchemeParserFindProjectCost(
            Text
        ),
        "interest_rates": SchemeParserFindInterestRates(
            Text
        ),
        "repayment_years": SchemeParserFindRepaymentPeriod(
            Text
        ),
        "moratorium_months": SchemeParserFindMoratorium(
            Text
        ),
        "eligibility": SchemeParserExtractEligibility(
            Text
        ),
        "source_id": Source.get(
            "source_id"
        ),
        "source_name": Source.get(
            "source_name"
        ),
        "source_url": Source.get(
            "url"
        ),
        "source_type": Source.get(
            "type",
            "webpage",
        ),
        "fetched_at": Source.get(
            "fetched_at",
            datetime.now().isoformat(),
        ),
        "parser_version": "1.1",
        "relevance_score": Relevance,
    }


def SchemeParserIsBelowMinimumLoanLimit(Scheme):
    try:
        Value = Scheme.get(
            "loan_limit"
        )

        return (
            Value is not None
            and float(Value) < MIN_LOAN_LIMIT
        )

    except (
        TypeError,
        ValueError,
        AttributeError,
    ):
        return False


def SchemeParserParseLiveSources(
    LiveSources
):
    Schemes = []
    Seen = set()

    for Source in LiveSources:

        Scheme = SchemeParserParseScheme(
            Source
        )

        if not Scheme:
            continue

        if SchemeParserIsBelowMinimumLoanLimit(
            Scheme
        ):
            continue

        Key = (
            Scheme["scheme_name"].lower(),
            str(
                Scheme["source_url"]
            ).lower(),
        )

        if Key in Seen:
            continue

        Seen.add(Key)

        Schemes.append(
            Scheme
        )

    return Schemes


def SchemeParserFilterScSchemes(Schemes):
    return [
        Scheme
        for Scheme in Schemes
        if Scheme.get("is_sc_scheme")
    ]


def SchemeParserFilterEducationSchemes(Schemes):
    return [
        Scheme
        for Scheme in Schemes
        if Scheme.get(
            "is_education_scheme"
        )
    ]


def SchemeParserFilterBusinessSchemes(Schemes):
    return [
        Scheme
        for Scheme in Schemes
        if Scheme.get(
            "is_business_scheme"
        )
    ]


def SchemeParserSortSchemes(Schemes):
    return sorted(
        Schemes,
        key=lambda Scheme: (
            Scheme.get(
                "relevance_score",
                0,
            ),
            Scheme.get(
                "is_sc_scheme",
                False,
            ),
        ),
        reverse=True,
    )



SchemeValidatorCurrentYear = datetime.now().year

SchemeValidatorValidSchemeStatuses = [
    "LIVE_VERIFIED",
    "LIVE_INCOMPLETE",
    "NEEDS_REVIEW",
    "SOURCE_UNAVAILABLE",
    "EXPIRED",
    "NOT_CONFIRMED",
]


def SchemeValidatorCleanText(Value):
    if Value is None:
        return ""

    return " ".join(
        str(Value).split()
    )


def SchemeValidatorIsPositiveNumber(Value):
    return (
        isinstance(
            Value,
            (int, float),
        )
        and Value > 0
    )


def SchemeValidatorHasPositiveLoanLimit(Scheme):
    try:
        Value = Scheme.get(
            "loan_limit"
        )

        return float(Value) >= MIN_LOAN_LIMIT

    except (
        TypeError,
        ValueError,
        AttributeError,
    ):
        return False


def SchemeValidatorValidateIncomeLimit(Value):
    if Value is None:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not SchemeValidatorIsPositiveNumber(
        Value
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Value,
        }

    if Value > 100000000:
        return {
            "valid": False,
            "status": "AMBIGUOUS",
            "value": Value,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Value,
    }


def SchemeValidatorValidateLoanLimit(Value):
    if Value is None:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not SchemeValidatorIsPositiveNumber(
        Value
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Value,
        }

    if Value > 1000000000:
        return {
            "valid": False,
            "status": "AMBIGUOUS",
            "value": Value,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Value,
    }


def SchemeValidatorValidateProjectCost(Value):
    if Value is None:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not SchemeValidatorIsPositiveNumber(
        Value
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Value,
        }

    if Value > 1000000000:
        return {
            "valid": False,
            "status": "AMBIGUOUS",
            "value": Value,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Value,
    }


def SchemeValidatorValidateInterestRates(Rates):
    if not Rates:
        return {
            "valid": False,
            "status": "MISSING",
            "value": [],
        }

    if not isinstance(
        Rates,
        list,
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Rates,
        }

    ValidRates = []

    for Rate in Rates:

        if isinstance(
            Rate,
            (int, float),
        ):

            if 0 < Rate <= 50:
                ValidRates.append(
                    float(Rate)
                )

    if not ValidRates:
        return {
            "valid": False,
            "status": "INVALID",
            "value": [],
        }

    ValidRates = sorted(
        set(ValidRates)
    )

    if len(ValidRates) > 1:
        return {
            "valid": True,
            "status": "RANGE_OR_MULTIPLE",
            "value": ValidRates,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": ValidRates,
    }


def SchemeValidatorValidateRepaymentPeriod(Value):
    if Value is None:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not isinstance(
        Value,
        (int, float),
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Value,
        }

    if Value <= 0 or Value > 30:
        return {
            "valid": False,
            "status": "AMBIGUOUS",
            "value": Value,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Value,
    }


def SchemeValidatorValidateMoratorium(Value):
    if Value is None:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not isinstance(
        Value,
        (int, float),
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": Value,
        }

    if Value < 0 or Value > 60:
        return {
            "valid": False,
            "status": "AMBIGUOUS",
            "value": Value,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Value,
    }


def SchemeValidatorValidateSchemeName(Name):
    Name = SchemeValidatorCleanText(
        Name
    )

    if not Name:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if Name.lower() in [
        "government scheme",
        "scheme",
        "financial assistance",
    ]:
        return {
            "valid": False,
            "status": "GENERIC",
            "value": Name,
        }

    if len(Name) < 4:
        return {
            "valid": False,
            "status": "TOO_SHORT",
            "value": Name,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": Name,
    }


def SchemeValidatorValidateSource(SourceUrl):
    SourceUrl = SchemeValidatorCleanText(
        SourceUrl
    )

    if not SourceUrl:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    if not SourceUrl.startswith(
        ("http://", "https://")
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": SourceUrl,
        }

    return {
        "valid": True,
        "status": "VALID",
        "value": SourceUrl,
    }


def SchemeValidatorValidateFetchedAt(FetchedAt):
    if not FetchedAt:
        return {
            "valid": False,
            "status": "MISSING",
            "value": None,
        }

    try:
        datetime.fromisoformat(
            FetchedAt
        )

        return {
            "valid": True,
            "status": "VALID",
            "value": FetchedAt,
        }

    except (
        ValueError,
        TypeError,
    ):
        return {
            "valid": False,
            "status": "INVALID",
            "value": FetchedAt,
        }


def SchemeValidatorFindExpirationIndicators(Text):
    Text = SchemeValidatorCleanText(
        Text
    ).lower()

    ExpirationKeywords = [
        "expired",
        "discontinued",
        "closed",
        "closed for applications",
        "scheme has ended",
        "scheme discontinued",
        "no longer available",
        "withdrawn",
        "terminated",
    ]

    return [
        Keyword
        for Keyword in ExpirationKeywords
        if Keyword in Text
    ]


def SchemeValidatorFindLiveIndicators(Text):
    Text = SchemeValidatorCleanText(
        Text
    ).lower()

    LiveKeywords = [
        "currently available",
        "apply now",
        "applications open",
        "application open",
        "ongoing",
        "active scheme",
        "currently implemented",
        "beneficiaries can apply",
        "online application",
    ]

    return [
        Keyword
        for Keyword in LiveKeywords
        if Keyword in Text
    ]


def SchemeValidatorCheckSchemeStatus(Scheme):
    TextParts = [
        Scheme.get(
            "scheme_name",
            "",
        ),
        Scheme.get(
            "source_name",
            "",
        ),
        " ".join(
            Scheme.get(
                "eligibility",
                [],
            )
        ),
    ]

    Text = SchemeValidatorCleanText(
        " ".join(TextParts)
    )

    ExpirationMatches = (
        SchemeValidatorFindExpirationIndicators(
            Text
        )
    )

    LiveMatches = (
        SchemeValidatorFindLiveIndicators(
            Text
        )
    )

    if ExpirationMatches:
        return {
            "status": "EXPIRED",
            "reason": ExpirationMatches,
            "live_indicators": LiveMatches,
        }

    if LiveMatches:
        return {
            "status": "LIVE_VERIFIED",
            "reason": [],
            "live_indicators": LiveMatches,
        }

    return {
        "status": "NOT_CONFIRMED",
        "reason": [],
        "live_indicators": [],
    }


def SchemeValidatorCalculateValidationScore(
    Validation,
    StatusResult,
):
    Total = 0
    Score = 0

    ImportantFields = [
        "scheme_name",
        "income_limit",
        "loan_limit",
        "interest_rates",
        "source_url",
        "fetched_at",
    ]

    for Field in ImportantFields:

        Total += 1

        if Validation[Field]["valid"]:
            Score += 1

    if StatusResult["status"] == "LIVE_VERIFIED":
        Score += 2
        Total += 2

    elif StatusResult["status"] == "NOT_CONFIRMED":
        Total += 2

    if Total == 0:
        return 0

    return round(
        Score / Total * 100,
        2,
    )


def SchemeValidatorValidateScheme(Scheme):
    Validation = {}

    Validation["scheme_name"] = (
        SchemeValidatorValidateSchemeName(
            Scheme.get("scheme_name")
        )
    )

    Validation["income_limit"] = (
        SchemeValidatorValidateIncomeLimit(
            Scheme.get("income_limit")
        )
    )

    Validation["loan_limit"] = (
        SchemeValidatorValidateLoanLimit(
            Scheme.get("loan_limit")
        )
    )

    Validation["project_cost_limit"] = (
        SchemeValidatorValidateProjectCost(
            Scheme.get("project_cost_limit")
        )
    )

    Validation["interest_rates"] = (
        SchemeValidatorValidateInterestRates(
            Scheme.get("interest_rates")
        )
    )

    Validation["repayment_years"] = (
        SchemeValidatorValidateRepaymentPeriod(
            Scheme.get("repayment_years")
        )
    )

    Validation["moratorium_months"] = (
        SchemeValidatorValidateMoratorium(
            Scheme.get("moratorium_months")
        )
    )

    Validation["source_url"] = (
        SchemeValidatorValidateSource(
            Scheme.get("source_url")
        )
    )

    Validation["fetched_at"] = (
        SchemeValidatorValidateFetchedAt(
            Scheme.get("fetched_at")
        )
    )

    MissingFields = []
    InvalidFields = []
    AmbiguousFields = []

    for Field, Result in Validation.items():

        if Result["status"] == "MISSING":
            MissingFields.append(Field)

        elif Result["status"] == "INVALID":
            InvalidFields.append(Field)

        elif Result["status"] in [
            "AMBIGUOUS",
            "RANGE_OR_MULTIPLE",
            "GENERIC",
        ]:
            AmbiguousFields.append(Field)

    StatusResult = (
        SchemeValidatorCheckSchemeStatus(
            Scheme
        )
    )

    if StatusResult["status"] == "EXPIRED":
        FinalStatus = "EXPIRED"

    elif not Validation[
        "scheme_name"
    ]["valid"]:
        FinalStatus = "NEEDS_REVIEW"

    elif not Validation[
        "source_url"
    ]["valid"]:
        FinalStatus = "SOURCE_UNAVAILABLE"

    elif (
        len(InvalidFields) > 0
        or len(AmbiguousFields) >= 3
    ):
        FinalStatus = "NEEDS_REVIEW"

    elif len(MissingFields) >= 4:
        FinalStatus = "LIVE_INCOMPLETE"

    elif StatusResult[
        "status"
    ] == "LIVE_VERIFIED":
        FinalStatus = "LIVE_VERIFIED"

    elif (
        len(InvalidFields) == 0
        and len(AmbiguousFields) == 0
        and Validation[
            "source_url"
        ]["valid"]
    ):
        FinalStatus = "LIVE_INCOMPLETE"

    else:
        FinalStatus = "NOT_CONFIRMED"

    Score = (
        SchemeValidatorCalculateValidationScore(
            Validation,
            StatusResult,
        )
    )

    return {
        "valid": FinalStatus
        in [
            "LIVE_VERIFIED",
            "LIVE_INCOMPLETE",
        ],
        "status": FinalStatus,
        "validation_score": Score,
        "missing_fields": MissingFields,
        "invalid_fields": InvalidFields,
        "ambiguous_fields": AmbiguousFields,
        "field_validation": Validation,
        "status_evidence": StatusResult,
    }


def SchemeValidatorValidateSchemes(Schemes):
    Validated = []

    for Scheme in Schemes:

        if not SchemeValidatorHasPositiveLoanLimit(
            Scheme
        ):
            continue

        Result = (
            SchemeValidatorValidateScheme(
                Scheme
            )
        )

        ValidatedScheme = dict(
            Scheme
        )

        ValidatedScheme[
            "validation"
        ] = Result

        Validated.append(
            ValidatedScheme
        )

    return Validated


def SchemeValidatorGetVerifiedSchemes(
    Schemes
):
    return [
        Scheme
        for Scheme in Schemes
        if (
            SchemeValidatorHasPositiveLoanLimit(
                Scheme
            )
            and Scheme.get(
                "validation",
                {},
            ).get("status")
            == "LIVE_VERIFIED"
        )
    ]


def SchemeValidatorGetIncompleteSchemes(
    Schemes
):
    return [
        Scheme
        for Scheme in Schemes
        if (
            SchemeValidatorHasPositiveLoanLimit(
                Scheme
            )
            and Scheme.get(
                "validation",
                {},
            ).get("status")
            == "LIVE_INCOMPLETE"
        )
    ]


def SchemeValidatorGetReviewSchemes(
    Schemes
):
    return [
        Scheme
        for Scheme in Schemes
        if (
            SchemeValidatorHasPositiveLoanLimit(
                Scheme
            )
            and Scheme.get(
                "validation",
                {},
            ).get("status")
            == "NEEDS_REVIEW"
        )
    ]


def SchemeValidatorGetExpiredSchemes(
    Schemes
):
    return [
        Scheme
        for Scheme in Schemes
        if (
            SchemeValidatorHasPositiveLoanLimit(
                Scheme
            )
            and Scheme.get(
                "validation",
                {},
            ).get("status")
            == "EXPIRED"
        )
    ]


def SchemeValidatorGetUsableSchemes(
    Schemes
):
    UsableStatuses = [
        "LIVE_VERIFIED",
        "LIVE_INCOMPLETE",
    ]

    return [
        Scheme
        for Scheme in Schemes
        if (
            SchemeValidatorHasPositiveLoanLimit(
                Scheme
            )
            and Scheme.get(
                "validation",
                {},
            ).get("status")
            in UsableStatuses
        )
    ]


def SchemeValidatorValidationSummary(
    Schemes
):
    Summary = {
        "total": len(Schemes),
        "live_verified": 0,
        "live_incomplete": 0,
        "needs_review": 0,
        "source_unavailable": 0,
        "expired": 0,
        "not_confirmed": 0,
    }

    for Scheme in Schemes:

        Status = Scheme.get(
            "validation",
            {},
        ).get(
            "status",
            "NOT_CONFIRMED",
        )

        Key = Status.lower()

        if Key in Summary:
            Summary[Key] += 1

    return Summary



SchemeMatcherDefaultIncomeLimit = 500000

SchemeMatcherDefaultWeights = {
    "category": 25,
    "income": 20,
    "project_cost": 20,
    "purpose": 15,
    "education": 10,
    "scheme_similarity": 10,
}


def SchemeMatcherCleanText(Value):
    if Value is None:
        return ""

    if isinstance(Value, list):
        Value = " ".join(
            str(Item)
            for Item in Value
        )

    return " ".join(
        str(Value).lower().split()
    )


def SchemeMatcherNormalizeCategory(
    Category
):
    Category = SchemeMatcherCleanText(
        Category
    )

    Mappings = {
        "sc": "scheduled caste",
        "scheduled caste": "scheduled caste",
        "scheduled castes": "scheduled caste",
        "st": "scheduled tribe",
        "obc": "other backward class",
        "general": "general",
    }

    return Mappings.get(
        Category,
        Category,
    )


def SchemeMatcherNormalizeProjectType(
    ProjectType
):
    ProjectType = SchemeMatcherCleanText(
        ProjectType
    )

    Mappings = {
        "business": "enterprise",
        "small business": "enterprise",
        "startup": "enterprise",
        "entrepreneurship": "enterprise",
        "self employment": "self employment",
        "education": "education",
        "education loan": "education",
        "educational": "education",
        "agriculture": "agriculture",
        "farming": "agriculture",
        "transport": "transport",
        "service": "service",
        "manufacturing": "manufacturing",
        "shop": "enterprise",
        "retail": "enterprise",
    }

    return Mappings.get(
        ProjectType,
        ProjectType,
    )


def SchemeMatcherNormalizeEducationStatus(
    Status
):
    Status = SchemeMatcherCleanText(
        Status
    )

    return Status in [
        "yes",
        "true",
        "student",
        "studying",
        "education",
        "higher education",
    ]


def SchemeMatcherGetSchemeText(Scheme):
    Parts = [
        Scheme.get(
            "scheme_name",
            "",
        ),
        Scheme.get(
            "scheme_type",
            "",
        ),
        Scheme.get(
            "source_name",
            "",
        ),
        Scheme.get(
            "eligibility",
            "",
        ),
    ]

    return SchemeMatcherCleanText(
        " ".join(
            str(Part)
            for Part in Parts
        )
    )


def SchemeMatcherIsVerifiedScheme(
    Scheme
):
    Validation = Scheme.get(
        "validation",
        {}
    )

    Status = Validation.get(
        "status",
        "NOT_CONFIRMED",
    )

    return Status in [
        "LIVE_VERIFIED",
        "LIVE_INCOMPLETE",
    ]


def SchemeMatcherHasPositiveLoanLimit(
    Scheme
):
    try:
        LoanLimit = float(
            Scheme.get(
                "loan_limit",
                0,
            )
            or 0
        )

        return LoanLimit >= MIN_LOAN_LIMIT

    except (
        TypeError,
        ValueError,
    ):
        return False


def SchemeMatcherIsScScheme(
    Scheme
):
    if Scheme.get(
        "is_sc_scheme"
    ):
        return True

    Text = SchemeMatcherGetSchemeText(
        Scheme
    )

    Keywords = [
        "scheduled caste",
        "scheduled castes",
        "sc beneficiary",
        "nsfdc",
    ]

    return any(
        Keyword in Text
        for Keyword in Keywords
    )


def SchemeMatcherIsEducationScheme(
    Scheme
):
    if Scheme.get(
        "is_education_scheme"
    ):
        return True

    Text = SchemeMatcherGetSchemeText(
        Scheme
    )

    Keywords = [
        "education loan",
        "educational loan",
        "higher education",
        "professional course",
        "technical education",
        "student",
    ]

    return any(
        Keyword in Text
        for Keyword in Keywords
    )


def SchemeMatcherIsBusinessScheme(
    Scheme
):
    if Scheme.get(
        "is_business_scheme"
    ):
        return True

    Text = SchemeMatcherGetSchemeText(
        Scheme
    )

    Keywords = [
        "term loan",
        "micro finance",
        "microfinance",
        "enterprise",
        "self employment",
        "entrepreneur",
        "business",
        "project",
    ]

    return any(
        Keyword in Text
        for Keyword in Keywords
    )


def SchemeMatcherIncomeMatch(
    UserIncome,
    Scheme,
):
    IncomeLimit = Scheme.get(
        "income_limit"
    )

    if not IncomeLimit:
        return {
            "eligible": True,
            "score": 8,
            "reason": (
                "Income limit could not be "
                "confirmed from the source."
            ),
        }

    if UserIncome <= IncomeLimit:

        Percentage = (
            UserIncome
            / IncomeLimit
            * 100
        )

        if Percentage <= 70:
            Score = 20

        elif Percentage <= 90:
            Score = 17

        else:
            Score = 15

        return {
            "eligible": True,
            "score": Score,
            "reason": (
                f"Family income ₹{UserIncome:,.0f} "
                f"is within the scheme limit of "
                f"₹{IncomeLimit:,.0f}."
            ),
        }

    return {
        "eligible": False,
        "score": 0,
        "reason": (
            f"Family income ₹{UserIncome:,.0f} "
            f"exceeds the scheme limit of "
            f"₹{IncomeLimit:,.0f}."
        ),
    }


def SchemeMatcherCategoryMatch(
    UserCategory,
    Scheme,
):
    Category = SchemeMatcherNormalizeCategory(
        UserCategory
    )

    if Category == "scheduled caste":

        if SchemeMatcherIsScScheme(
            Scheme
        ):
            return {
                "eligible": True,
                "score": 25,
                "reason": (
                    "The scheme is identified as "
                    "relevant to SC beneficiaries."
                ),
            }

        return {
            "eligible": True,
            "score": 10,
            "reason": (
                "The scheme does not explicitly "
                "identify SC eligibility."
            ),
        }

    return {
        "eligible": True,
        "score": 10,
        "reason": (
            "Category-specific restriction "
            "could not be confirmed."
        ),
    }


def SchemeMatcherProjectCostMatch(
    ProjectCost,
    Scheme,
):
    LoanLimit = Scheme.get(
        "loan_limit"
    )

    ProjectLimit = Scheme.get(
        "project_cost_limit"
    )

    Limit = None

    if LoanLimit:
        Limit = LoanLimit

    if ProjectLimit:

        if Limit:
            Limit = min(
                Limit,
                ProjectLimit,
            )
        else:
            Limit = ProjectLimit

    if not Limit:
        return {
            "eligible": True,
            "score": 8,
            "reason": (
                "No confirmed project or loan "
                "limit was extracted."
            ),
        }

    if ProjectCost <= Limit:

        Utilization = (
            ProjectCost
            / Limit
            * 100
        )

        if Utilization <= 70:
            Score = 20

        elif Utilization <= 90:
            Score = 17

        else:
            Score = 15

        return {
            "eligible": True,
            "score": Score,
            "reason": (
                f"Project cost ₹{ProjectCost:,.0f} "
                f"fits within the applicable limit "
                f"of ₹{Limit:,.0f}."
            ),
        }

    return {
        "eligible": False,
        "score": 0,
        "reason": (
            f"Project cost ₹{ProjectCost:,.0f} "
            f"exceeds the applicable limit of "
            f"₹{Limit:,.0f}."
        ),
    }


def SchemeMatcherPurposeMatch(
    ProjectType,
    EducationStatus,
    Scheme,
):
    ProjectType = SchemeMatcherNormalizeProjectType(
        ProjectType
    )

    Education = SchemeMatcherNormalizeEducationStatus(
        EducationStatus
    )

    EducationScheme = SchemeMatcherIsEducationScheme(
        Scheme
    )

    BusinessScheme = SchemeMatcherIsBusinessScheme(
        Scheme
    )

    if Education:

        if EducationScheme:
            return {
                "eligible": True,
                "score": 15,
                "reason": (
                    "The scheme supports "
                    "education-related financing."
                ),
            }

        if BusinessScheme:
            return {
                "eligible": False,
                "score": 0,
                "reason": (
                    "The scheme appears focused "
                    "on enterprise/business financing."
                ),
            }

    if ProjectType == "education":

        if EducationScheme:
            return {
                "eligible": True,
                "score": 15,
                "reason": (
                    "The scheme matches "
                    "the education purpose."
                ),
            }

        return {
            "eligible": False,
            "score": 0,
            "reason": (
                "The scheme does not appear "
                "to support education."
            ),
        }

    if ProjectType in [
        "enterprise",
        "self employment",
        "agriculture",
        "transport",
        "service",
        "manufacturing",
    ]:

        if BusinessScheme:
            return {
                "eligible": True,
                "score": 15,
                "reason": (
                    "The scheme supports enterprise "
                    "or income-generating activities."
                ),
            }

        return {
            "eligible": True,
            "score": 5,
            "reason": (
                "Purpose compatibility could "
                "not be fully confirmed."
            ),
        }

    return {
        "eligible": True,
        "score": 5,
        "reason": (
            "Project-purpose compatibility "
            "could not be fully confirmed."
        ),
    }


def SchemeMatcherEducationMatch(
    EducationStatus,
    Scheme,
):
    Education = SchemeMatcherNormalizeEducationStatus(
        EducationStatus
    )

    EducationScheme = SchemeMatcherIsEducationScheme(
        Scheme
    )

    if Education and EducationScheme:
        return {
            "eligible": True,
            "score": 10,
            "reason": (
                "Education status aligns "
                "with the scheme."
            ),
        }

    if not Education and EducationScheme:
        return {
            "eligible": False,
            "score": 0,
            "reason": (
                "This scheme is intended for "
                "education-related financing."
            ),
        }

    return {
        "eligible": True,
        "score": 5,
        "reason": (
            "No education-specific conflict detected."
        ),
    }


def SchemeMatcherBuildUserText(Profile):
    Parts = [
        Profile.get(
            "category",
            "",
        ),
        Profile.get(
            "project_type",
            "",
        ),
        Profile.get(
            "purpose",
            "",
        ),
        Profile.get(
            "location",
            "",
        ),
        Profile.get(
            "education_level",
            "",
        ),
        Profile.get(
            "course",
            "",
        ),
    ]

    if Profile.get(
        "education_status"
    ):
        Parts.append(
            "education student higher education"
        )

    return SchemeMatcherCleanText(
        " ".join(
            str(Part)
            for Part in Parts
        )
    )


def SchemeMatcherCalculateTfidfSimilarity(
    Profile,
    Schemes,
):
    if not Schemes:
        return []

    if (
        TfidfVectorizer is None
        or cosine_similarity is None
    ):
        return [
            0.0
            for _ in Schemes
        ]

    UserText = SchemeMatcherBuildUserText(
        Profile
    )

    SchemeTexts = [
        SchemeMatcherGetSchemeText(
            Scheme
        )
        for Scheme in Schemes
    ]

    Documents = [
        UserText
    ] + SchemeTexts

    try:

        Vectorizer = TfidfVectorizer(
            stop_words="english"
        )

        Matrix = Vectorizer.fit_transform(
            Documents
        )

        Similarities = cosine_similarity(
            Matrix[0:1],
            Matrix[1:],
        )[0]

        return [
            float(Value)
            for Value in Similarities
        ]

    except Exception:
        return [
            0.0
            for _ in Schemes
        ]


def SchemeMatcherCalculateMatch(
    Profile,
    Scheme,
    Similarity,
):
    try:
        UserIncome = float(
            Profile.get(
                "family_income",
                0,
            )
        )
    except (
        TypeError,
        ValueError,
    ):
        UserIncome = 0

    try:
        ProjectCost = float(
            Profile.get(
                "project_cost",
                0,
            )
        )
    except (
        TypeError,
        ValueError,
    ):
        ProjectCost = 0

    CategoryResult = (
        SchemeMatcherCategoryMatch(
            Profile.get(
                "category",
                "",
            ),
            Scheme,
        )
    )

    IncomeResult = (
        SchemeMatcherIncomeMatch(
            UserIncome,
            Scheme,
        )
    )

    ProjectResult = (
        SchemeMatcherProjectCostMatch(
            ProjectCost,
            Scheme,
        )
    )

    PurposeResult = (
        SchemeMatcherPurposeMatch(
            Profile.get(
                "project_type",
                "",
            ),
            Profile.get(
                "education_status"
            ),
            Scheme,
        )
    )

    EducationResult = (
        SchemeMatcherEducationMatch(
            Profile.get(
                "education_status"
            ),
            Scheme,
        )
    )

    HardFailures = []

    if not IncomeResult["eligible"]:
        HardFailures.append(
            IncomeResult["reason"]
        )

    if not ProjectResult["eligible"]:
        HardFailures.append(
            ProjectResult["reason"]
        )

    if not PurposeResult["eligible"]:
        HardFailures.append(
            PurposeResult["reason"]
        )

    if not EducationResult["eligible"]:
        HardFailures.append(
            EducationResult["reason"]
        )

    SimilarityScore = round(
        Similarity * 10,
        2,
    )

    TotalScore = (
        CategoryResult["score"]
        + IncomeResult["score"]
        + ProjectResult["score"]
        + PurposeResult["score"]
        + EducationResult["score"]
        + SimilarityScore
    )

    TotalScore = min(
        100,
        round(
            TotalScore,
            2,
        ),
    )

    EligibilityStatus = (
        "NOT_ELIGIBLE"
        if HardFailures
        else "ELIGIBLE"
    )

    Reasons = [
        CategoryResult["reason"],
        IncomeResult["reason"],
        ProjectResult["reason"],
        PurposeResult["reason"],
        EducationResult["reason"],
    ]

    if SimilarityScore > 0:
        Reasons.append(
            "AI text matching similarity "
            f"contributed {SimilarityScore:.1f} points."
        )

    return {
        "score": TotalScore,
        "eligibility_status": EligibilityStatus,
        "reasons": Reasons,
        "eligibility_failures": HardFailures,
        "components": {
            "category": CategoryResult["score"],
            "income": IncomeResult["score"],
            "project_cost": ProjectResult["score"],
            "purpose": PurposeResult["score"],
            "education": EducationResult["score"],
            "ai_similarity": SimilarityScore,
        },
    }


def SchemeMatcherMatchSchemes(
    Profile,
    Schemes,
    MinimumScore=40,
):
    UsableSchemes = [
        Scheme
        for Scheme in Schemes
        if (
            SchemeMatcherIsVerifiedScheme(
                Scheme
            )
            and SchemeMatcherHasPositiveLoanLimit(
                Scheme
            )
        )
    ]

    if not UsableSchemes:
        return []

    Similarities = (
        SchemeMatcherCalculateTfidfSimilarity(
            Profile,
            UsableSchemes,
        )
    )

    Results = []

    for Index, Scheme in enumerate(
        UsableSchemes
    ):

        Similarity = (
            Similarities[Index]
            if Index < len(Similarities)
            else 0.0
        )

        Match = (
            SchemeMatcherCalculateMatch(
                Profile,
                Scheme,
                Similarity,
            )
        )

        if (
            Match["eligibility_status"]
            == "ELIGIBLE"
            and Match["score"]
            >= MinimumScore
        ):

            Result = dict(
                Scheme
            )

            Result["match"] = Match

            Results.append(
                Result
            )

    Results.sort(
        key=lambda Item: Item[
            "match"
        ]["score"],
        reverse=True,
    )

    for Rank, Result in enumerate(
        Results,
        start=1,
    ):
        Result[
            "match"
        ]["rank"] = Rank

    return Results


def SchemeMatcherGetBestMatch(
    Profile,
    Schemes,
):
    Results = SchemeMatcherMatchSchemes(
        Profile,
        Schemes,
    )

    if not Results:
        return None

    return Results[0]


def SchemeMatcherGetTopMatches(
    Profile,
    Schemes,
    Limit=5,
):
    Results = SchemeMatcherMatchSchemes(
        Profile,
        Schemes,
    )

    return Results[:Limit]


def SchemeMatcherGenerateMatchSummary(
    Result
):
    if not Result:
        return {
            "title": "No suitable scheme found",
            "message": (
                "No currently usable scheme "
                "satisfied the available "
                "eligibility conditions."
            ),
        }

    Scheme = Result.get(
        "scheme_name",
        "Government Scheme",
    )

    Score = Result.get(
        "match",
        {},
    ).get(
        "score",
        0,
    )

    Reasons = Result.get(
        "match",
        {},
    ).get(
        "reasons",
        [],
    )

    return {
        "title": Scheme,
        "match_score": Score,
        "message": (
            "This scheme has an AI/rule-based "
            f"match score of {Score:.1f}%."
        ),
        "reasons": Reasons,
    }


def SchemeMatcherCreateProfile(
    Category,
    FamilyIncome,
    ProjectType,
    ProjectCost,
    EducationStatus=False,
    Location="",
):
    try:
        FamilyIncome = float(
            FamilyIncome
        )
    except (
        TypeError,
        ValueError,
    ):
        FamilyIncome = 0.0

    try:
        ProjectCost = float(
            ProjectCost
        )
    except (
        TypeError,
        ValueError,
    ):
        ProjectCost = 0.0

    return {
        "category": Category,
        "family_income": FamilyIncome,
        "project_type": ProjectType,
        "project_cost": ProjectCost,
        "education_status": EducationStatus,
        "location": Location,
    }



def FinancialCalculatorCleanNumber(
    Value
):
    if Value is None:
        return None

    if isinstance(
        Value,
        (int, float),
    ):
        return float(Value)

    Text = str(Value).strip()

    Text = (
        Text.replace("₹", "")
        .replace(",", "")
        .replace("%", "")
    )

    try:
        return float(Text)

    except (
        ValueError,
        TypeError,
    ):
        return None


def FinancialCalculatorHasPositiveLoanLimit(
    Scheme
):
    if not isinstance(
        Scheme,
        dict,
    ):
        return False

    LoanLimit = (
        FinancialCalculatorCleanNumber(
            Scheme.get(
                "loan_limit"
            )
        )
    )

    return (
        LoanLimit is not None
        and LoanLimit >= MIN_LOAN_LIMIT
    )


def FinancialCalculatorNormalizeInterestRate(
    Value
):
    if Value is None:
        return None

    if isinstance(
        Value,
        (list, tuple, set),
    ):

        Rates = []

        for Item in Value:

            Number = (
                FinancialCalculatorCleanNumber(
                    Item
                )
            )

            if (
                Number is not None
                and 0 <= Number <= 100
            ):
                Rates.append(
                    Number
                )

        return (
            Rates
            if Rates
            else None
        )

    Number = (
        FinancialCalculatorCleanNumber(
            Value
        )
    )

    if (
        Number is None
        or Number < 0
        or Number > 100
    ):
        return None

    return [Number]


def FinancialCalculatorGetInterestRateRange(
    Scheme
):
    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return None

    Rates = (
        FinancialCalculatorNormalizeInterestRate(
            Scheme.get(
                "interest_rates"
            )
        )
    )

    if not Rates:
        return None

    return {
        "minimum": min(Rates),
        "maximum": max(Rates),
    }


def FinancialCalculatorValidateLoanAmount(
    LoanAmount
):
    Amount = (
        FinancialCalculatorCleanNumber(
            LoanAmount
        )
    )

    if Amount is None or Amount < MIN_LOAN_LIMIT:
        raise ValueError(
            f"Loan amount must be at least "
            f"₹{MIN_LOAN_LIMIT:,}"
        )

    return Amount


def FinancialCalculatorValidateInterestRate(
    InterestRate
):
    Rate = (
        FinancialCalculatorCleanNumber(
            InterestRate
        )
    )

    if Rate is None:
        raise ValueError(
            "Interest rate is unavailable"
        )

    if Rate < 0 or Rate > 100:
        raise ValueError(
            "Invalid interest rate"
        )

    return Rate


def FinancialCalculatorValidateTenure(
    TenureYears
):
    Tenure = (
        FinancialCalculatorCleanNumber(
            TenureYears
        )
    )

    if Tenure is None or Tenure <= 0:
        raise ValueError(
            "Repayment period is unavailable"
        )

    return Tenure


def FinancialCalculatorValidateMoratorium(
    MoratoriumMonths
):
    if MoratoriumMonths is None:
        return 0

    Months = (
        FinancialCalculatorCleanNumber(
            MoratoriumMonths
        )
    )

    if Months is None or Months < 0:
        return 0

    return int(Months)


def FinancialCalculatorCalculateEmi(
    Principal,
    AnnualInterestRate,
    TenureYears,
):
    Principal = (
        FinancialCalculatorValidateLoanAmount(
            Principal
        )
    )

    AnnualInterestRate = (
        FinancialCalculatorValidateInterestRate(
            AnnualInterestRate
        )
    )

    TenureYears = (
        FinancialCalculatorValidateTenure(
            TenureYears
        )
    )

    Months = int(
        round(
            TenureYears * 12
        )
    )

    if Months <= 0:
        raise ValueError(
            "Invalid repayment period"
        )

    MonthlyRate = (
        AnnualInterestRate
        / 12
        / 100
    )

    if MonthlyRate == 0:

        Emi = (
            Principal / Months
        )

    else:

        Factor = math.pow(
            1 + MonthlyRate,
            Months,
        )

        Emi = (
            Principal
            * MonthlyRate
            * Factor
            / (Factor - 1)
        )

    TotalPayment = (
        Emi * Months
    )

    TotalInterest = (
        TotalPayment
        - Principal
    )

    return {
        "principal": round(
            Principal,
            2,
        ),
        "annual_interest_rate": round(
            AnnualInterestRate,
            4,
        ),
        "tenure_years": TenureYears,
        "tenure_months": Months,
        "monthly_emi": round(
            Emi,
            2,
        ),
        "total_payment": round(
            TotalPayment,
            2,
        ),
        "total_interest": round(
            TotalInterest,
            2,
        ),
    }


def FinancialCalculatorCalculateZeroInterestEmi(
    Principal,
    TenureYears,
):
    Principal = (
        FinancialCalculatorValidateLoanAmount(
            Principal
        )
    )

    TenureYears = (
        FinancialCalculatorValidateTenure(
            TenureYears
        )
    )

    Months = int(
        round(
            TenureYears * 12
        )
    )

    if Months <= 0:
        raise ValueError(
            "Invalid repayment period"
        )

    Emi = (
        Principal / Months
    )

    return {
        "principal": round(
            Principal,
            2,
        ),
        "annual_interest_rate": 0,
        "tenure_years": TenureYears,
        "tenure_months": Months,
        "monthly_emi": round(
            Emi,
            2,
        ),
        "total_payment": round(
            Principal,
            2,
        ),
        "total_interest": 0,
    }


def FinancialCalculatorCalculateStandardLoan(
    Principal,
    AnnualInterestRate,
    TenureYears,
    MoratoriumMonths=0,
):
    Result = (
        FinancialCalculatorCalculateEmi(
            Principal,
            AnnualInterestRate,
            TenureYears,
        )
    )

    Result[
        "moratorium_months"
    ] = FinancialCalculatorValidateMoratorium(
        MoratoriumMonths
    )

    return Result


def FinancialCalculatorCalculateMoratorium(
    Principal,
    AnnualInterestRate,
    MoratoriumMonths,
    CapitalizeInterest=True,
):
    Principal = (
        FinancialCalculatorValidateLoanAmount(
            Principal
        )
    )

    AnnualInterestRate = (
        FinancialCalculatorValidateInterestRate(
            AnnualInterestRate
        )
    )

    MoratoriumMonths = (
        FinancialCalculatorValidateMoratorium(
            MoratoriumMonths
        )
    )

    if MoratoriumMonths == 0:
        return {
            "original_principal": round(
                Principal,
                2,
            ),
            "moratorium_months": 0,
            "interest_during_moratorium": 0,
            "principal_after_moratorium": round(
                Principal,
                2,
            ),
        }

    Interest = (
        Principal
        * (AnnualInterestRate / 100)
        * (MoratoriumMonths / 12)
    )

    if CapitalizeInterest:
        PrincipalAfter = (
            Principal + Interest
        )
    else:
        PrincipalAfter = Principal

    return {
        "original_principal": round(
            Principal,
            2,
        ),
        "moratorium_months": MoratoriumMonths,
        "interest_during_moratorium": round(
            Interest,
            2,
        ),
        "principal_after_moratorium": round(
            PrincipalAfter,
            2,
        ),
        "capitalized_interest": CapitalizeInterest,
    }


def FinancialCalculatorCalculateInterestRange(
    Principal,
    InterestRates,
    TenureYears,
):
    Rates = (
        FinancialCalculatorNormalizeInterestRate(
            InterestRates
        )
    )

    if not Rates:
        return {
            "available": False,
            "message": (
                "EMI unavailable — scheme source "
                "does not provide a confirmed "
                "interest rate."
            ),
        }

    Results = []

    for Rate in Rates:

        Result = (
            FinancialCalculatorCalculateEmi(
                Principal,
                Rate,
                TenureYears,
            )
        )

        Results.append(
            Result
        )

    Minimum = min(
        Results,
        key=lambda x: x[
            "monthly_emi"
        ],
    )

    Maximum = max(
        Results,
        key=lambda x: x[
            "monthly_emi"
        ],
    )

    return {
        "available": True,
        "minimum_rate": min(Rates),
        "maximum_rate": max(Rates),
        "minimum_emi": Minimum[
            "monthly_emi"
        ],
        "maximum_emi": Maximum[
            "monthly_emi"
        ],
        "minimum_total_interest": Minimum[
            "total_interest"
        ],
        "maximum_total_interest": Maximum[
            "total_interest"
        ],
        "calculations": Results,
    }


def FinancialCalculatorGetSchemeFinancialDetails(
    Scheme
):
    if not isinstance(
        Scheme,
        dict,
    ):
        return {
            "available": False,
            "emi_available": False,
            "message": "Invalid scheme data.",
        }

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return {
            "available": False,
            "emi_available": False,
            "message": (
                "EMI unavailable — this scheme "
                "does not have a valid positive "
                "loan limit."
            ),
        }

    LoanLimit = (
        FinancialCalculatorCleanNumber(
            Scheme.get(
                "loan_limit"
            )
        )
    )

    Rates = (
        FinancialCalculatorNormalizeInterestRate(
            Scheme.get(
                "interest_rates"
            )
        )
    )

    Tenure = (
        FinancialCalculatorCleanNumber(
            Scheme.get(
                "repayment_years"
            )
        )
    )

    Moratorium = (
        FinancialCalculatorValidateMoratorium(
            Scheme.get(
                "moratorium_months"
            )
        )
    )

    Missing = []

    if (
        LoanLimit is None
        or LoanLimit < MIN_LOAN_LIMIT
    ):
        Missing.append(
            "maximum loan amount"
        )

    if not Rates:
        Missing.append(
            "confirmed interest rate"
        )

    if (
        Tenure is None
        or Tenure <= 0
    ):
        Missing.append(
            "repayment period"
        )

    if Missing:
        return {
            "available": False,
            "emi_available": False,
            "missing_parameters": Missing,
            "message": (
                "EMI unavailable — scheme source "
                "does not provide sufficient "
                "financial parameters."
            ),
        }

    return {
        "available": True,
        "emi_available": True,
        "loan_limit": LoanLimit,
        "interest_rates": Rates,
        "minimum_interest_rate": min(Rates),
        "maximum_interest_rate": max(Rates),
        "repayment_years": Tenure,
        "moratorium_months": Moratorium,
    }


def FinancialCalculatorCalculateSchemeEmi(
    Scheme,
    LoanAmount=None,
    InterestRate=None,
    TenureYears=None,
):
    if not FinancialCalculatorHasPositiveLoanLimit(Scheme):
        return {
            "available": False,
            "emi_available": False,
            "message": (
                "EMI unavailable — this scheme "
                "has no valid loan limit (minimum ₹1,000)."
            ),
        }

    LoanLimit = FinancialCalculatorCleanNumber(Scheme.get("loan_limit"))
    Details = None


    if LoanAmount is None or InterestRate is None or TenureYears is None:
        Details = FinancialCalculatorGetSchemeFinancialDetails(Scheme)

    if LoanAmount is None:
        if not Details or not Details.get("available"):
            return Details or {
                "available": False,
                "emi_available": False,
                "message": "EMI unavailable — loan amount could not be determined.",
            }
        LoanAmount = Details["loan_limit"]

    LoanAmount = FinancialCalculatorValidateLoanAmount(LoanAmount)

    if LoanLimit is not None and LoanAmount > LoanLimit:
        LoanAmount = LoanLimit

    if InterestRate is None:
        if not Details or not Details.get("available"):
            return Details or {
                "available": False,
                "emi_available": False,
                "message": "EMI unavailable — interest rate could not be determined.",
            }

        Rates = Details["interest_rates"]
        if len(Rates) == 1:
            InterestRate = Rates[0]
        else:
            return {
                "available": False,
                "emi_available": False,
                "message": (
                    "EMI unavailable — the live scheme source provides multiple "
                    "interest rates without identifying which rate applies to this applicant."
                ),
                "available_interest_rates": Rates,
            }
    else:
        InterestRate = FinancialCalculatorValidateInterestRate(InterestRate)

    if TenureYears is None:
        if not Details or not Details.get("available"):
            return Details or {
                "available": False,
                "emi_available": False,
                "message": "EMI unavailable — repayment period could not be determined.",
            }
        TenureYears = Details["repayment_years"]
    else:
        TenureYears = FinancialCalculatorValidateTenure(TenureYears)

    try:
        Result = FinancialCalculatorCalculateEmi(
            LoanAmount, InterestRate, TenureYears
        )
    except ValueError as Error:
        return {
            "available": False,
            "emi_available": False,
            "message": f"EMI unavailable — {str(Error)}",
        }

    Result["moratorium_months"] = (
        Details.get("moratorium_months", 0)
        if Details and Details.get("available")
        else 0
    )
    Result["scheme_name"] = Scheme.get(
        "name", Scheme.get("scheme_name", "Unknown Scheme")
    )
    Result["emi_available"] = True
    return Result

def FinancialCalculatorCalculateSchemeRateRange(
    Scheme,
    LoanAmount=None,
    TenureYears=None,
):
    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return {
            "available": False,
            "emi_available": False,
            "message": (
                "Rate calculation unavailable — "
                "this scheme has no valid positive "
                "loan limit."
            ),
        }

    Details = (
        FinancialCalculatorGetSchemeFinancialDetails(
            Scheme
        )
    )

    if not Details["available"]:
        return Details

    if LoanAmount is None:
        LoanAmount = Details[
            "loan_limit"
        ]

    if TenureYears is None:
        TenureYears = Details[
            "repayment_years"
        ]

    return (
        FinancialCalculatorCalculateInterestRange(
            LoanAmount,
            Details[
                "interest_rates"
            ],
            TenureYears,
        )
    )


def FinancialCalculatorCalculateLoanEligibility(
    Scheme,
    ProjectCost,
    RequestedAmount,
):
    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return {
            "eligible": False,
            "message": (
                "Loan unavailable — this scheme "
                "does not have a valid positive "
                "loan limit."
            ),
        }

    ProjectCost = (
        FinancialCalculatorCleanNumber(
            ProjectCost
        )
    )

    RequestedAmount = (
        FinancialCalculatorCleanNumber(
            RequestedAmount
        )
    )

    if (
        ProjectCost is None
        or ProjectCost <= 0
    ):
        return {
            "eligible": False,
            "message": "Invalid project cost.",
        }

    if (
        RequestedAmount is None
        or RequestedAmount < MIN_LOAN_LIMIT
    ):
        return {
            "eligible": False,
            "message": (
                "Invalid requested loan amount. "
                f"Minimum is ₹{MIN_LOAN_LIMIT:,}."
            ),
        }

    LoanLimit = (
        FinancialCalculatorCleanNumber(
            Scheme.get(
                "loan_limit"
            )
        )
    )

    if (
        LoanLimit is None
        or LoanLimit < MIN_LOAN_LIMIT
    ):
        return {
            "eligible": False,
            "message": (
                "Loan limit unavailable in "
                "live scheme data."
            ),
        }

    EligibleAmount = min(
        RequestedAmount,
        ProjectCost,
        LoanLimit,
    )

    return {
        "eligible": True,
        "project_cost": round(
            ProjectCost,
            2,
        ),
        "requested_amount": round(
            RequestedAmount,
            2,
        ),
        "maximum_scheme_loan": round(
            LoanLimit,
            2,
        ),
        "eligible_loan_amount": round(
            EligibleAmount,
            2,
        ),
        "requested_amount_within_limit": (
            RequestedAmount <= LoanLimit
        ),
    }


def FinancialCalculatorFormatCurrency(
    Value
):
    Number = (
        FinancialCalculatorCleanNumber(
            Value
        )
    )

    if Number is None:
        return "Unavailable"

    return f"₹{Number:,.2f}"


def FinancialCalculatorGenerateCalculatorSummary(
    Scheme,
    LoanAmount=None,
):
    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return {
            "scheme_name": Scheme.get(
                "name",
                Scheme.get(
                    "scheme_name",
                    "Unknown Scheme",
                ),
            ),
            "emi_available": False,
            "message": (
                "EMI unavailable — this scheme "
                "has no valid loan limit (minimum ₹1,000)."
            ),
        }

    Details = (
        FinancialCalculatorGetSchemeFinancialDetails(
            Scheme
        )
    )

    if not Details["available"]:
        return {
            "scheme_name": Scheme.get(
                "name",
                Scheme.get(
                    "scheme_name",
                    "Unknown Scheme",
                ),
            ),
            "emi_available": False,
            "message": Details[
                "message"
            ],
            "missing_parameters": Details.get(
                "missing_parameters",
                [],
            ),
        }

    EmiResult = (
        FinancialCalculatorCalculateSchemeEmi(
            Scheme,
            LoanAmount=LoanAmount,
        )
    )

    if not EmiResult.get(
        "emi_available"
    ):
        return {
            "scheme_name": Scheme.get(
                "name",
                Scheme.get(
                    "scheme_name",
                    "Unknown Scheme",
                ),
            ),
            "emi_available": False,
            "message": EmiResult.get(
                "message",
                "EMI unavailable.",
            ),
        }

    return {
        "scheme_name": Scheme.get(
            "name",
            Scheme.get(
                "scheme_name",
                "Unknown Scheme",
            ),
        ),
        "emi_available": True,
        "loan_amount": FinancialCalculatorFormatCurrency(
            EmiResult[
                "principal"
            ]
        ),
        "interest_rate": (
            f"{EmiResult['annual_interest_rate']:.2f}%"
        ),
        "tenure": (
            f"{EmiResult['tenure_years']:.1f} years"
        ),
        "moratorium": (
            f"{Details['moratorium_months']} months"
        ),
        "monthly_emi": FinancialCalculatorFormatCurrency(
            EmiResult[
                "monthly_emi"
            ]
        ),
        "total_payment": FinancialCalculatorFormatCurrency(
            EmiResult[
                "total_payment"
            ]
        ),
        "total_interest": FinancialCalculatorFormatCurrency(
            EmiResult[
                "total_interest"
            ]
        ),
    }



PartnerLocatorNsfdcUrl = (
    "https://nsfdc.nic.in/"
)

PartnerLocatorRequestTimeout = 20

PartnerLocatorSupportedPartnerTypes = [
    "State Channelizing Agency",
    "Public Sector Bank",
    "Regional Rural Bank",
    "NBFC-MFI",
    "Cooperative Bank",
    "Cooperative Society",
    "Small Finance Bank",
    "SIDBI",
    "Other Agency",
]


def PartnerLocatorCleanText(Value):
    if Value is None:
        return ""

    return re.sub(
        r"\s+",
        " ",
        str(Value),
    ).strip()


def PartnerLocatorCleanNumber(Value):
    if Value is None:
        return None

    try:
        return float(
            str(Value)
            .replace(",", "")
            .replace("₹", "")
            .strip()
        )

    except (
        ValueError,
        TypeError,
    ):
        return None


def PartnerLocatorCalculateDistance(
    Latitude1,
    Longitude1,
    Latitude2,
    Longitude2,
):
    Latitude1 = (
        PartnerLocatorCleanNumber(
            Latitude1
        )
    )

    Longitude1 = (
        PartnerLocatorCleanNumber(
            Longitude1
        )
    )

    Latitude2 = (
        PartnerLocatorCleanNumber(
            Latitude2
        )
    )

    Longitude2 = (
        PartnerLocatorCleanNumber(
            Longitude2
        )
    )

    if None in [
        Latitude1,
        Longitude1,
        Latitude2,
        Longitude2,
    ]:
        return None

    Radius = 6371.0

    Lat1 = math.radians(
        Latitude1
    )

    Lat2 = math.radians(
        Latitude2
    )

    DeltaLat = math.radians(
        Latitude2 - Latitude1
    )

    DeltaLon = math.radians(
        Longitude2 - Longitude1
    )

    Value = (
        math.sin(
            DeltaLat / 2
        ) ** 2
        + math.cos(Lat1)
        * math.cos(Lat2)
        * math.sin(
            DeltaLon / 2
        ) ** 2
    )

    Value = min(
        1,
        max(
            0,
            Value,
        ),
    )

    Distance = (
        2
        * Radius
        * math.asin(
            math.sqrt(Value)
        )
    )

    return round(
        Distance,
        2,
    )


def PartnerLocatorNormalizePartnerType(
    Value
):
    Text = PartnerLocatorCleanText(
        Value
    ).lower()

    if (
        "state" in Text
        and (
            "channel" in Text
            or "agency" in Text
        )
    ):
        return "State Channelizing Agency"

    if (
        "regional rural" in Text
        or Text == "rrb"
    ):
        return "Regional Rural Bank"

    if (
        "nbfc" in Text
        or "mfi" in Text
    ):
        return "NBFC-MFI"

    if "cooperative society" in Text:
        return "Cooperative Society"

    if "cooperative bank" in Text:
        return "Cooperative Bank"

    if "small finance" in Text:
        return "Small Finance Bank"

    if (
        "public sector bank" in Text
        or "psb" in Text
    ):
        return "Public Sector Bank"

    if "sidbi" in Text:
        return "SIDBI"

    return PartnerLocatorCleanText(
        Value
    )


def PartnerLocatorNormalizeStatus(
    Value
):
    Text = PartnerLocatorCleanText(
        Value
    ).lower()


    if any(
        Word in Text
        for Word in [
            "inactive",
            "closed",
            "suspended",
            "not eligible",
        ]
    ):
        return "INACTIVE"

    if any(
        Word in Text
        for Word in [
            "active",
            "operational",
            "eligible",
            "available",
        ]
    ):
        return "ACTIVE"

    return "UNKNOWN"


def PartnerLocatorNormalizeSchemeName(
    Value
):
    Text = PartnerLocatorCleanText(
        Value
    ).lower()

    if any(
        Word in Text
        for Word in [
            "micro finance",
            "mfs",
        ]
    ):
        return "Micro Finance Scheme"

    if (
        "aajeevika" in Text
        or "amy" in Text
    ):
        return (
            "Aajeevika Micro-Finance Yojana"
        )

    if "term loan" in Text:
        return "Term Loan"

    if (
        "udyam nidhi" in Text
        or "uny" in Text
    ):
        return "Udyam Nidhi Yojana"

    if (
        "education" in Text
        or "educational loan" in Text
    ):
        return "Educational Loan Scheme"

    if (
        "visvas" in Text
        or "interest subvention" in Text
    ):
        return "VISVAS"

    return PartnerLocatorCleanText(
        Value
    )


def PartnerLocatorNormalizeSchemeList(
    Value
):
    if Value is None:
        return []

    if isinstance(
        Value,
        list,
    ):
        return [
            PartnerLocatorNormalizeSchemeName(
                Item
            )
            for Item in Value
            if PartnerLocatorCleanText(
                Item
            )
        ]

    Text = PartnerLocatorCleanText(
        Value
    )

    if not Text:
        return []

    Parts = re.split(
        r"[,;|]",
        Text,
    )

    return [
        PartnerLocatorNormalizeSchemeName(
            Item
        )
        for Item in Parts
        if PartnerLocatorCleanText(
            Item
        )
    ]


def PartnerLocatorExtractLinks(
    Url
):
    try:

        Response = requests.get(
            Url,
            timeout=PartnerLocatorRequestTimeout,
            headers={
                "User-Agent":
                    "EAI-Scheme-Matching-System/1.0"
            },
        )

        Response.raise_for_status()

        Soup = BeautifulSoup(
            Response.text,
            "html.parser",
        )

        Links = []

        for Anchor in Soup.find_all("a"):

            Href = Anchor.get(
                "href"
            )

            if not Href:
                continue

            Text = PartnerLocatorCleanText(
                Anchor.get_text(
                    " ",
                    strip=True,
                )
            )

            Links.append(
                {
                    "text": Text,
                    "url": Href,
                }
            )

        return Links

    except requests.RequestException:
        return []


def PartnerLocatorDiscoverPartnerPages():
    Links = PartnerLocatorExtractLinks(
        PartnerLocatorNsfdcUrl
    )

    PartnerLocatorLinks = []

    Keywords = [
        "channel partner",
        "channel partners",
        "partner",
        "sca",
        "bank",
        "rrb",
        "nbfc",
        "mfi",
        "cooperative",
    ]

    for Link in Links:

        Text = (
            PartnerLocatorCleanText(
                Link.get("text")
            )
            + " "
            + PartnerLocatorCleanText(
                Link.get("url")
            )
        ).lower()

        if any(
            Keyword in Text
            for Keyword in Keywords
        ):
            PartnerLocatorLinks.append(
                Link
            )

    return PartnerLocatorLinks


def PartnerLocatorParsePartnerTables(
    Url
):
    try:

        Response = requests.get(
            Url,
            timeout=PartnerLocatorRequestTimeout,
            headers={
                "User-Agent":
                    "EAI-Scheme-Matching-System/1.0"
            },
        )

        Response.raise_for_status()

        Soup = BeautifulSoup(
            Response.text,
            "html.parser",
        )

        Partners = []

        for Table in Soup.find_all(
            "table"
        ):

            Rows = Table.find_all(
                "tr"
            )

            if not Rows:
                continue

            Headers = [
                PartnerLocatorCleanText(
                    Cell.get_text(
                        " ",
                        strip=True,
                    )
                ).lower()
                for Cell in Rows[0].find_all(
                    ["th", "td"]
                )
            ]

            if not Headers:
                continue

            for Row in Rows[1:]:

                Cells = Row.find_all(
                    ["td", "th"]
                )

                Values = [
                    PartnerLocatorCleanText(
                        Cell.get_text(
                            " ",
                            strip=True,
                        )
                    )
                    for Cell in Cells
                ]

                if not Values:
                    continue

                Record = {
                    "name": "",
                    "partner_type": "",
                    "state": "",
                    "district": "",
                    "address": "",
                    "phone": "",
                    "email": "",
                    "website": "",
                    "status": "UNKNOWN",
                    "supported_schemes": [],
                    "latitude": None,
                    "longitude": None,
                    "source_url": Url,
                    "data_source": "NSFDC",
                }

                for Index, Header in enumerate(
                    Headers
                ):

                    if Index >= len(
                        Values
                    ):
                        continue

                    Value = Values[
                        Index
                    ]

                    if (
                        "name" in Header
                        or "agency" in Header
                    ):
                        Record[
                            "name"
                        ] = Value

                    elif (
                        "type" in Header
                        or "category" in Header
                    ):
                        Record[
                            "partner_type"
                        ] = (
                            PartnerLocatorNormalizePartnerType(
                                Value
                            )
                        )

                    elif "state" in Header:
                        Record[
                            "state"
                        ] = Value

                    elif "district" in Header:
                        Record[
                            "district"
                        ] = Value

                    elif "address" in Header:
                        Record[
                            "address"
                        ] = Value

                    elif (
                        "phone" in Header
                        or "mobile" in Header
                    ):
                        Record[
                            "phone"
                        ] = Value

                    elif "email" in Header:
                        Record[
                            "email"
                        ] = Value

                    elif (
                        "website" in Header
                        or "url" in Header
                    ):
                        Record[
                            "website"
                        ] = Value

                    elif "status" in Header:
                        Record[
                            "status"
                        ] = (
                            PartnerLocatorNormalizeStatus(
                                Value
                            )
                        )

                    elif "scheme" in Header:
                        Record[
                            "supported_schemes"
                        ] = (
                            PartnerLocatorNormalizeSchemeList(
                                Value
                            )
                        )

                    elif (
                        "latitude" in Header
                        or Header == "lat"
                    ):
                        Record[
                            "latitude"
                        ] = (
                            PartnerLocatorCleanNumber(
                                Value
                            )
                        )

                    elif (
                        "longitude" in Header
                        or Header == "lon"
                        or Header == "lng"
                    ):
                        Record[
                            "longitude"
                        ] = (
                            PartnerLocatorCleanNumber(
                                Value
                            )
                        )

                if Record["name"]:
                    Partners.append(
                        Record
                    )

        return Partners

    except requests.RequestException:
        return []


def PartnerLocatorNormalizePartner(
    Partner
):
    if not isinstance(
        Partner,
        dict,
    ):
        return None

    Name = PartnerLocatorCleanText(
        Partner.get("name")
    )

    if not Name:
        return None

    return {
        "name": Name,

        "partner_type": (
            PartnerLocatorNormalizePartnerType(
                Partner.get(
                    "partner_type",
                    "",
                )
            )
        ),

        "state": PartnerLocatorCleanText(
            Partner.get(
                "state",
                "",
            )
        ),

        "district": PartnerLocatorCleanText(
            Partner.get(
                "district",
                "",
            )
        ),

        "address": PartnerLocatorCleanText(
            Partner.get(
                "address",
                "",
            )
        ),

        "phone": PartnerLocatorCleanText(
            Partner.get(
                "phone",
                "",
            )
        ),

        "email": PartnerLocatorCleanText(
            Partner.get(
                "email",
                "",
            )
        ),

        "website": PartnerLocatorCleanText(
            Partner.get(
                "website",
                "",
            )
        ),

        "status": PartnerLocatorNormalizeStatus(
            Partner.get(
                "status",
                "",
            )
        ),

        "supported_schemes": (
            PartnerLocatorNormalizeSchemeList(
                Partner.get(
                    "supported_schemes",
                    [],
                )
            )
        ),

        "latitude": PartnerLocatorCleanNumber(
            Partner.get(
                "latitude"
            )
        ),

        "longitude": PartnerLocatorCleanNumber(
            Partner.get(
                "longitude"
            )
        ),

        "fund_utilization_status": (
            PartnerLocatorCleanText(
                Partner.get(
                    "fund_utilization_status",
                    "NOT_PUBLISHED",
                )
            )
            or "NOT_PUBLISHED"
        ),

        "npa_status": (
            PartnerLocatorCleanText(
                Partner.get(
                    "npa_status",
                    "NOT_PUBLISHED",
                )
            )
            or "NOT_PUBLISHED"
        ),

        "overdue_status": (
            PartnerLocatorCleanText(
                Partner.get(
                    "overdue_status",
                    "NOT_PUBLISHED",
                )
            )
            or "NOT_PUBLISHED"
        ),

        "source_url": PartnerLocatorCleanText(
            Partner.get(
                "source_url",
                "",
            )
        ),

        "data_source": PartnerLocatorCleanText(
            Partner.get(
                "data_source",
                "NSFDC",
            )
        ),

        "fetched_at": datetime.now().isoformat(),
    }


def PartnerLocatorLoadLivePartners():
    DiscoveredPages = (
        PartnerLocatorDiscoverPartnerPages()
    )

    AllPartners = []

    for Page in DiscoveredPages:

        Url = Page.get(
            "url"
        )

        if not Url:
            continue

        Url = urljoin(
            PartnerLocatorNsfdcUrl,
            Url,
        )

        if not Url.startswith(
            "http"
        ):
            continue

        Partners = (
            PartnerLocatorParsePartnerTables(
                Url
            )
        )

        AllPartners.extend(
            Partners
        )

    Normalized = []
    Seen = set()

    for Partner in AllPartners:

        Item = (
            PartnerLocatorNormalizePartner(
                Partner
            )
        )

        if not Item:
            continue

        Key = (
            Item["name"].lower(),
            Item["state"].lower(),
            Item["district"].lower(),
        )

        if Key in Seen:
            continue

        Seen.add(Key)

        Normalized.append(
            Item
        )

    return Normalized


def PartnerLocatorPartnerSupportsScheme(
    Partner,
    Scheme,
):
    SchemeName = (
        PartnerLocatorNormalizeSchemeName(
            Scheme
        )
    )

    Supported = [
        PartnerLocatorNormalizeSchemeName(
            Item
        )
        for Item in Partner.get(
            "supported_schemes",
            [],
        )
    ]

    if not Supported:
        return True

    if SchemeName in Supported:
        return True

    SchemeText = SchemeName.lower()

    for SupportedScheme in Supported:

        SupportedText = (
            SupportedScheme.lower()
        )

        if (
            SupportedText in SchemeText
            or SchemeText in SupportedText
        ):
            return True

    return False


def PartnerLocatorPartnerHasKnownRisk(
    Partner
):
    NpaStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "npa_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    OverdueStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "overdue_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    FundStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "fund_utilization_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    if NpaStatus in [
        "HIGH",
        "CRITICAL",
    ]:
        return True

    if OverdueStatus in [
        "HIGH",
        "CRITICAL",
    ]:
        return True

    if FundStatus in [
        "EXHAUSTED",
        "UNAVAILABLE",
        "FULL",
    ]:
        return True

    return False


def PartnerLocatorPartnerRiskStatus(
    Partner
):
    NpaStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "npa_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    OverdueStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "overdue_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    FundStatus = (
        PartnerLocatorCleanText(
            Partner.get(
                "fund_utilization_status",
                "NOT_PUBLISHED",
            )
        ).upper()
    )

    Values = [
        NpaStatus,
        OverdueStatus,
        FundStatus,
    ]

    if any(
        Value in [
            "HIGH",
            "CRITICAL",
            "EXHAUSTED",
            "UNAVAILABLE",
            "FULL",
        ]
        for Value in Values
    ):
        return "HIGH_RISK"

    if all(
        Value in [
            "NOT_PUBLISHED",
            "UNKNOWN",
            "",
        ]
        for Value in Values
    ):
        return "DATA_NOT_PUBLISHED"

    return "NO_KNOWN_RISK"


def PartnerLocatorCalculatePartnerScore(
    Partner,
    Distance,
    Scheme=None,
):
    Score = 0.0

    if Distance is not None:

        if Distance <= 5:
            Score += 60

        elif Distance <= 10:
            Score += 50

        elif Distance <= 25:
            Score += 40

        elif Distance <= 50:
            Score += 30

        elif Distance <= 100:
            Score += 20

        else:
            Score += 10

    if Partner.get(
        "status"
    ) == "ACTIVE":
        Score += 20

    if (
        Scheme
        and PartnerLocatorPartnerSupportsScheme(
            Partner,
            Scheme,
        )
    ):
        Score += 15

    RiskStatus = (
        PartnerLocatorPartnerRiskStatus(
            Partner
        )
    )

    if RiskStatus == "NO_KNOWN_RISK":
        Score += 5

    if RiskStatus == "HIGH_RISK":
        Score -= 100

    return round(
        Score,
        2,
    )


def PartnerLocatorFindNearestPartners(
    Latitude,
    Longitude,
    Partners,
    Scheme=None,
    Limit=5,
):
    Latitude = PartnerLocatorCleanNumber(
        Latitude
    )

    Longitude = PartnerLocatorCleanNumber(
        Longitude
    )

    if (
        Latitude is None
        or Longitude is None
    ):
        return []

    Results = []

    for Partner in Partners:

        Normalized = (
            PartnerLocatorNormalizePartner(
                Partner
            )
        )

        if not Normalized:
            continue

        if (
            Normalized["status"]
            == "INACTIVE"
        ):
            continue

        if (
            Scheme
            and not PartnerLocatorPartnerSupportsScheme(
                Normalized,
                Scheme,
            )
        ):
            continue

        if PartnerLocatorPartnerHasKnownRisk(
            Normalized
        ):
            continue

        PartnerLatitude = Normalized.get(
            "latitude"
        )

        PartnerLongitude = Normalized.get(
            "longitude"
        )

        if (
            PartnerLatitude is None
            or PartnerLongitude is None
        ):
            continue

        Distance = (
            PartnerLocatorCalculateDistance(
                Latitude,
                Longitude,
                PartnerLatitude,
                PartnerLongitude,
            )
        )

        if Distance is None:
            continue

        Normalized[
            "distance_km"
        ] = Distance

        Normalized[
            "risk_status"
        ] = PartnerLocatorPartnerRiskStatus(
            Normalized
        )

        Normalized[
            "score"
        ] = PartnerLocatorCalculatePartnerScore(
            Normalized,
            Distance,
            Scheme,
        )

        Results.append(
            Normalized
        )

    Results.sort(
        key=lambda Item: (
            -Item["score"],
            Item["distance_km"],
        )
    )

    return Results[:Limit]


def PartnerLocatorFindNearestPartnersWithoutRiskFilter(
    Latitude,
    Longitude,
    Partners,
    Scheme=None,
    Limit=5,
):
    Latitude = PartnerLocatorCleanNumber(
        Latitude
    )

    Longitude = PartnerLocatorCleanNumber(
        Longitude
    )

    if (
        Latitude is None
        or Longitude is None
    ):
        return []

    Results = []

    for Partner in Partners:

        Normalized = (
            PartnerLocatorNormalizePartner(
                Partner
            )
        )

        if not Normalized:
            continue

        if (
            Normalized["status"]
            == "INACTIVE"
        ):
            continue

        if (
            Scheme
            and not PartnerLocatorPartnerSupportsScheme(
                Normalized,
                Scheme,
            )
        ):
            continue

        if (
            Normalized["latitude"] is None
            or Normalized["longitude"] is None
        ):
            continue

        Distance = (
            PartnerLocatorCalculateDistance(
                Latitude,
                Longitude,
                Normalized["latitude"],
                Normalized["longitude"],
            )
        )

        if Distance is None:
            continue

        Normalized[
            "distance_km"
        ] = Distance

        Normalized[
            "risk_status"
        ] = PartnerLocatorPartnerRiskStatus(
            Normalized
        )

        Normalized[
            "score"
        ] = PartnerLocatorCalculatePartnerScore(
            Normalized,
            Distance,
            Scheme,
        )

        Results.append(
            Normalized
        )

    Results.sort(
        key=lambda Item: (
            -Item["score"],
            Item["distance_km"],
        )
    )

    return Results[:Limit]


def PartnerLocatorRouteApplication(
    Latitude,
    Longitude,
    Partners,
    Scheme=None,
):
    SafeResults = (
        PartnerLocatorFindNearestPartners(
            Latitude,
            Longitude,
            Partners,
            Scheme,
            5,
        )
    )

    if SafeResults:

        Selected = SafeResults[0]

        return {
            "routing_available": True,
            "partner": Selected,
            "alternatives": SafeResults[1:],
            "routing_message": (
                "Nearest known eligible partner selected."
            ),
        }

    Results = (
        PartnerLocatorFindNearestPartnersWithoutRiskFilter(
            Latitude,
            Longitude,
            Partners,
            Scheme,
            5,
        )
    )

    if Results:

        return {
            "routing_available": True,
            "partner": Results[0],
            "alternatives": Results[1:],
            "routing_message": (
                "Partner found, but live NPA, overdue "
                "or fund-utilization information is "
                "not published for verification."
            ),
        }

    return {
        "routing_available": False,
        "partner": None,
        "alternatives": [],
        "routing_message": (
            "No geographically mapped eligible "
            "partner was found in the available "
            "government data."
        ),
    }


def PartnerLocatorBuildPartnerSummary(
    Partner
):
    if not Partner:
        return None

    return {
        "name": Partner.get(
            "name",
            "Unknown",
        ),
        "partner_type": Partner.get(
            "partner_type",
            "Unknown",
        ),
        "state": Partner.get(
            "state",
            "",
        ),
        "district": Partner.get(
            "district",
            "",
        ),
        "address": Partner.get(
            "address",
            "",
        ),
        "distance_km": Partner.get(
            "distance_km"
        ),
        "status": Partner.get(
            "status",
            "UNKNOWN",
        ),
        "risk_status": Partner.get(
            "risk_status",
            "DATA_NOT_PUBLISHED",
        ),
        "fund_utilization_status": Partner.get(
            "fund_utilization_status",
            "NOT_PUBLISHED",
        ),
        "npa_status": Partner.get(
            "npa_status",
            "NOT_PUBLISHED",
        ),
        "overdue_status": Partner.get(
            "overdue_status",
            "NOT_PUBLISHED",
        ),
        "source_url": Partner.get(
            "source_url",
            "",
        ),
    }


def PartnerLocatorValidateCoordinates(
    Latitude,
    Longitude,
):
    Latitude = PartnerLocatorCleanNumber(
        Latitude
    )

    Longitude = PartnerLocatorCleanNumber(
        Longitude
    )

    if (
        Latitude is None
        or Longitude is None
    ):
        return False

    if Latitude < -90 or Latitude > 90:
        return False

    if Longitude < -180 or Longitude > 180:
        return False

    return True



def HasPositiveLoanLimit(Scheme):
    if not isinstance(
        Scheme,
        dict,
    ):
        return False

    try:

        LoanLimit = float(
            Scheme.get(
                "loan_limit",
                0,
            )
            or 0
        )

        return LoanLimit >= MIN_LOAN_LIMIT

    except (
        TypeError,
        ValueError,
    ):
        return False


def FilterValidLoanSchemes(
    Schemes
):
    if not isinstance(
        Schemes,
        list,
    ):
        return []

    return [
        Scheme
        for Scheme in Schemes
        if FinancialCalculatorHasPositiveLoanLimit(
            Scheme
        )
    ]


def RefreshSchemes():
    global SchemesCache
    global LastSchemeSync

    try:

        Sources = (
            GovernmentFetchLiveSchemeSources()
        )

        ParsedSchemes = (
            SchemeParserParseLiveSources(
                Sources
            )
        )

        ValidatedSchemes = (
            SchemeValidatorValidateSchemes(
                ParsedSchemes
            )
        )

        UsableSchemes = (
            SchemeValidatorGetUsableSchemes(
                ValidatedSchemes
            )
        )

        UsableSchemes = (
            FilterValidLoanSchemes(
                UsableSchemes
            )
        )

        SchemesCache = UsableSchemes

        LastSchemeSync = (
            datetime.now().isoformat()
        )

        return {
            "success": True,
            "schemes": SchemesCache,
            "source_count": len(
                Sources
            ),
            "scheme_count": len(
                SchemesCache
            ),
            "sync_time": LastSchemeSync,
            "validation": (
                SchemeValidatorValidationSummary(
                    ValidatedSchemes
                )
            ),
        }

    except Exception as Error:

        SchemesCache = (
            FilterValidLoanSchemes(
                SchemesCache
            )
        )

        return {
            "success": False,
            "schemes": SchemesCache,
            "source_count": 0,
            "scheme_count": len(
                SchemesCache
            ),
            "sync_time": LastSchemeSync,
            "error": str(Error),
        }


def RefreshPartners():
    global PartnersCache
    global LastPartnerSync

    try:

        Partners = (
            PartnerLocatorLoadLivePartners()
        )

        PartnersCache = Partners

        LastPartnerSync = (
            datetime.now().isoformat()
        )

        return {
            "success": True,
            "partners": PartnersCache,
            "partner_count": len(
                PartnersCache
            ),
            "sync_time": LastPartnerSync,
        }

    except Exception as Error:

        return {
            "success": False,
            "partners": PartnersCache,
            "partner_count": len(
                PartnersCache
            ),
            "sync_time": LastPartnerSync,
            "error": str(Error),
        }


def EnsureSchemesLoaded():
    global SchemesCache

    if not SchemesCache:
        return RefreshSchemes()

    SchemesCache = (
        FilterValidLoanSchemes(
            SchemesCache
        )
    )

    return {
        "success": True,
        "schemes": SchemesCache,
        "scheme_count": len(
            SchemesCache
        ),
        "sync_time": LastSchemeSync,
    }


def EnsurePartnersLoaded():
    if not PartnersCache:
        return RefreshPartners()

    return {
        "success": True,
        "partners": PartnersCache,
        "partner_count": len(
            PartnersCache
        ),
        "sync_time": LastPartnerSync,
    }



@Application.route("/")
def Home():
    return render_template(
        "index.html"
    )


@Application.route(
    "/api/health",
    methods=["GET"],
)
def Health():
    return jsonify(
        {
            "success": True,
            "application": Application.config[
                "APP_NAME"
            ],
            "status": "running",
            "scheme_count": len(
                FilterValidLoanSchemes(
                    SchemesCache
                )
            ),
            "partner_count": len(
                PartnersCache
            ),
            "scheme_sync": LastSchemeSync,
            "partner_sync": LastPartnerSync,
            "timestamp": datetime.now().isoformat(),
        }
    )


@Application.route(
    "/api/ui-strings/<lang>",
    methods=["GET"],
)
def UiStrings(lang):
    Lang = (lang or "").strip().lower()

    if not Lang or Lang == "en":
        Merged = LoadTranslationSourceFile("translate.json")
        Merged.update(LoadTranslationSourceFile("transliterate.json"))
        return jsonify(Merged)

    with _UiStringsCacheLock:
        Cached = _UiStringsCache.get(Lang)
    if Cached is not None:
        return jsonify(Cached)

    if not TranslationSupportsLanguage(Lang):
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "This language is not available "
                        "with Google Translate yet."
                    ),
                }
            ),
            400,
        )

    try:
        Merged = BuildUiStringsForLanguage(Lang)
    except Exception as Error:
        Application.logger.warning(
            "UI translation failed for %s: %s",
            Lang,
            type(Error).__name__,
        )

        Message = (
            str(Error)
            if isinstance(Error, GoogleTranslateError)
            else "Translation service unavailable."
        )

        return (
            jsonify(
                {
                    "success": False,
                    "error": Message,
                }
            ),
            502,
        )

    with _UiStringsCacheLock:
        _UiStringsCache[Lang] = Merged

    return jsonify(Merged)


@Application.route(
    "/api/schemes",
    methods=["GET"],
)
def GetSchemes():
    Result = EnsureSchemesLoaded()

    Schemes = FilterValidLoanSchemes(
        Result["schemes"]
    )

    return jsonify(
        {
            "success": Result["success"],
            "schemes": Schemes,
            "count": len(Schemes),
            "last_updated": Result[
                "sync_time"
            ],
            "error": Result.get(
                "error"
            ),
        }
    )


@Application.route(
    "/api/refresh",
    methods=["POST"],
)
def Refresh():
    SchemeResult = RefreshSchemes()

    PartnerResult = RefreshPartners()

    return jsonify(
        {
            "success": (
                SchemeResult["success"]
                or PartnerResult["success"]
            ),

            "schemes": {
                "success": SchemeResult[
                    "success"
                ],
                "count": SchemeResult[
                    "scheme_count"
                ],
                "last_updated": SchemeResult[
                    "sync_time"
                ],
                "error": SchemeResult.get(
                    "error"
                ),
            },

            "partners": {
                "success": PartnerResult[
                    "success"
                ],
                "count": PartnerResult[
                    "partner_count"
                ],
                "last_updated": PartnerResult[
                    "sync_time"
                ],
                "error": PartnerResult.get(
                    "error"
                ),
            },
        }
    )


@Application.route(
    "/api/sync-status",
    methods=["GET"],
)
def SyncStatus():
    ValidSchemeCount = len(
        FilterValidLoanSchemes(
            SchemesCache
        )
    )

    return jsonify(
        {
            "success": True,

            "schemes": {
                "count": ValidSchemeCount,
                "last_updated": LastSchemeSync,
            },

            "partners": {
                "count": len(
                    PartnersCache
                ),
                "last_updated": LastPartnerSync,
            },
        }
    )


@Application.route(
    "/api/match",
    methods=["POST"],
)
def Match():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    SchemeResult = (
        EnsureSchemesLoaded()
    )

    Schemes = FilterValidLoanSchemes(
        SchemeResult["schemes"]
    )

    if not Schemes:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "No verified government "
                        "schemes with a loan limit of at "
                        "least ₹1,000 are currently available."
                    ),
                }
            ),
            503,
        )

    try:

        Profile = (
            SchemeMatcherCreateProfile(
                Data.get(
                    "category",
                    Data.get(
                        "social_category",
                        "",
                    ),
                ),
                Data.get(
                    "family_income",
                    Data.get(
                        "income",
                        0,
                    ),
                ),
                Data.get(
                    "project_type",
                    "",
                ),
                Data.get(
                    "project_cost",
                    0,
                ),
                Data.get(
                    "education_status",
                    Data.get(
                        "education",
                        False,
                    ),
                ),
                Data.get(
                    "location",
                    "",
                ),
            )
        )

        Profile[
            "education_level"
        ] = Data.get(
            "education_level",
            "",
        )

        Profile[
            "course"
        ] = Data.get(
            "course",
            "",
        )

        Profile[
            "purpose"
        ] = Data.get(
            "purpose",
            "",
        )

        try:
            Limit = int(
                Data.get(
                    "limit",
                    5,
                )
            )
        except (
            TypeError,
            ValueError,
        ):
            Limit = 5

        Limit = max(
            1,
            min(
                Limit,
                50,
            ),
        )

        TopMatches = (
            SchemeMatcherGetTopMatches(
                Profile,
                Schemes,
                Limit=Limit,
            )
        )

        TopMatches = FilterValidLoanSchemes(
            TopMatches
        )

        Summary = (
            SchemeMatcherGenerateMatchSummary(
                TopMatches[0]
                if TopMatches
                else None
            )
        )

        return jsonify(
            {
                "success": True,
                "profile": Profile,
                "matches": TopMatches,
                "summary": Summary,
                "count": len(
                    TopMatches
                ),
            }
        )

    except Exception as Error:

        return (
            jsonify(
                {
                    "success": False,
                    "error": str(Error),
                }
            ),
            400,
        )


@Application.route(
    "/api/recommend",
    methods=["POST"],
)
def Recommend():
    return Match()


@Application.route(
    "/api/scheme/<int:index>",
    methods=["GET"],
)
def GetScheme(index):
    Result = EnsureSchemesLoaded()

    Schemes = FilterValidLoanSchemes(
        Result["schemes"]
    )

    if (
        index < 0
        or index >= len(Schemes)
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Scheme not found.",
                }
            ),
            404,
        )

    Scheme = Schemes[index]

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "Scheme not available."
                    ),
                }
            ),
            404,
        )

    return jsonify(
        {
            "success": True,
            "scheme": Scheme,
        }
    )


@Application.route(
    "/api/calculate-emi",
    methods=["POST"],
)
def CalculateEmi():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Scheme = Data.get(
        "scheme"
    )

    if not Scheme:

        SchemeName = Data.get(
            "scheme_name"
        )

        Result = (
            EnsureSchemesLoaded()
        )

        Schemes = FilterValidLoanSchemes(
            Result["schemes"]
        )

        for Item in Schemes:

            ItemName = Item.get(
                "name",
                Item.get(
                    "scheme_name",
                    "",
                ),
            )

            if (
                str(ItemName).lower()
                == str(
                    SchemeName or ""
                ).lower()
            ):
                Scheme = Item
                break

    if not Scheme:
        return (
            jsonify(
                {
                    "success": False,
                    "emi_available": False,
                    "error": (
                        "Scheme data was not "
                        "provided or found."
                    ),
                }
            ),
            404,
        )

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "emi_available": False,
                    "error": (
                        "This scheme has no valid "
                        "loan limit of at least ₹1,000."
                    ),
                }
            ),
            400,
        )

    try:

        LoanAmount = Data.get(
            "loan_amount",
            Data.get("loanAmount"),
        )
        InterestRate = Data.get(
            "interest_rate",
            Data.get("interestRate"),
        )
        TenureYears = Data.get(
            "tenure_years",
            Data.get(
                "tenureYears",
                Data.get("tenure"),
            ),
        )

        Result = (
            FinancialCalculatorCalculateSchemeEmi(
                Scheme,
                LoanAmount=LoanAmount,
                InterestRate=InterestRate,
                TenureYears=TenureYears,
            )
        )

        return jsonify(
            {
                "success": Result.get(
                    "emi_available",
                    False,
                ),
                **Result,
            }
        )

    except Exception as Error:

        return (
            jsonify(
                {
                    "success": False,
                    "emi_available": False,
                    "error": str(Error),
                }
            ),
            400,
        )


@Application.route(
    "/api/calculator-summary",
    methods=["POST"],
)
def CalculatorSummary():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Scheme = Data.get(
        "scheme"
    )

    if not Scheme:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "Scheme data is required."
                    ),
                }
            ),
            400,
        )

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "emi_available": False,
                    "error": (
                        "This scheme has no valid "
                        "loan limit of at least ₹1,000."
                    ),
                }
            ),
            400,
        )

    try:

        Result = (
            FinancialCalculatorGenerateCalculatorSummary(
                Scheme,
                Data.get(
                    "loan_amount"
                ),
            )
        )

        return jsonify(
            {
                "success": Result.get(
                    "emi_available",
                    False,
                ),
                **Result,
            }
        )

    except Exception as Error:

        return (
            jsonify(
                {
                    "success": False,
                    "error": str(Error),
                }
            ),
            400,
        )


@Application.route(
    "/api/rate-range",
    methods=["POST"],
)
def RateRange():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Scheme = Data.get(
        "scheme"
    )

    if not Scheme:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "Scheme data is required."
                    ),
                }
            ),
            400,
        )

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "available": False,
                    "error": (
                        "Rate calculation unavailable — "
                        "this scheme has no valid positive "
                        "loan limit."
                    ),
                }
            ),
            400,
        )

    try:

        Result = (
            FinancialCalculatorCalculateSchemeRateRange(
                Scheme,
                LoanAmount=Data.get(
                    "loan_amount"
                ),
                TenureYears=Data.get(
                    "tenure_years"
                ),
            )
        )

        return jsonify(
            {
                "success": Result.get(
                    "available",
                    False,
                ),
                **Result,
            }
        )

    except Exception as Error:

        return (
            jsonify(
                {
                    "success": False,
                    "available": False,
                    "error": str(Error),
                }
            ),
            400,
        )


@Application.route(
    "/api/loan-eligibility",
    methods=["POST"],
)
def LoanEligibility():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Scheme = Data.get(
        "scheme"
    )

    if not Scheme:
        return (
            jsonify(
                {
                    "success": False,
                    "eligible": False,
                    "error": (
                        "Scheme data is required."
                    ),
                }
            ),
            400,
        )

    if not FinancialCalculatorHasPositiveLoanLimit(
        Scheme
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "eligible": False,
                    "error": (
                        "Loan unavailable — this "
                        "scheme does not have a valid "
                        "loan limit of at least ₹1,000."
                    ),
                }
            ),
            400,
        )

    try:

        Result = (
            FinancialCalculatorCalculateLoanEligibility(
                Scheme,
                Data.get(
                    "project_cost"
                ),
                Data.get(
                    "requested_amount"
                ),
            )
        )

        return jsonify(
            {
                "success": Result.get(
                    "eligible",
                    False,
                ),
                **Result,
            }
        )

    except Exception as Error:

        return (
            jsonify(
                {
                    "success": False,
                    "eligible": False,
                    "error": str(Error),
                }
            ),
            400,
        )


@Application.route(
    "/api/partners",
    methods=["GET"],
)
def GetPartners():
    Result = EnsurePartnersLoaded()

    return jsonify(
        {
            "success": Result["success"],
            "partners": Result[
                "partners"
            ],
            "count": Result[
                "partner_count"
            ],
            "last_updated": Result[
                "sync_time"
            ],
            "error": Result.get(
                "error"
            ),
        }
    )


@Application.route(
    "/api/partners/nearby",
    methods=["POST"],
)
def NearbyPartners():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Latitude = Data.get(
        "latitude"
    )

    Longitude = Data.get(
        "longitude"
    )

    if not PartnerLocatorValidateCoordinates(
        Latitude,
        Longitude,
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "Valid latitude and "
                        "longitude are required."
                    ),
                }
            ),
            400,
        )

    PartnerResult = (
        EnsurePartnersLoaded()
    )

    Partners = PartnerResult[
        "partners"
    ]

    try:
        Limit = int(
            Data.get(
                "limit",
                5,
            )
        )
    except (
        TypeError,
        ValueError,
    ):
        Limit = 5

    Limit = max(
        1,
        min(
            Limit,
            50,
        ),
    )

    Results = (
        PartnerLocatorFindNearestPartners(
            Latitude,
            Longitude,
            Partners,
            Data.get(
                "scheme"
            ),
            Limit,
        )
    )

    return jsonify(
        {
            "success": True,
            "partners": [
                PartnerLocatorBuildPartnerSummary(
                    Partner
                )
                for Partner in Results
            ],
            "count": len(
                Results
            ),
            "last_updated": PartnerResult[
                "sync_time"
            ],
        }
    )


@Application.route(
    "/api/route",
    methods=["POST"],
)
def Route():
    Data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    Latitude = Data.get(
        "latitude"
    )

    Longitude = Data.get(
        "longitude"
    )

    if not PartnerLocatorValidateCoordinates(
        Latitude,
        Longitude,
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        "Valid latitude and "
                        "longitude are required."
                    ),
                }
            ),
            400,
        )

    PartnerResult = (
        EnsurePartnersLoaded()
    )

    Routing = (
        PartnerLocatorRouteApplication(
            Latitude,
            Longitude,
            PartnerResult[
                "partners"
            ],
            Data.get(
                "scheme"
            ),
        )
    )

    if Routing.get(
        "partner"
    ):
        Routing[
            "partner"
        ] = PartnerLocatorBuildPartnerSummary(
            Routing["partner"]
        )

    Routing[
        "alternatives"
    ] = [
        PartnerLocatorBuildPartnerSummary(
            Partner
        )
        for Partner in Routing.get(
            "alternatives",
            [],
        )
    ]

    Routing[
        "last_updated"
    ] = PartnerResult[
        "sync_time"
    ]

    return jsonify(
        {
            "success": Routing[
                "routing_available"
            ],
            **Routing,
        }
    )



@Application.errorhandler(404)
def NotFound(Error):
    return (
        jsonify(
            {
                "success": False,
                "error": (
                    "API endpoint not found."
                ),
            }
        ),
        404,
    )


@Application.errorhandler(500)
def ServerError(Error):
    return (
        jsonify(
            {
                "success": False,
                "error": (
                    "Internal server error."
                ),
            }
        ),
        500,
    )



if __name__ == "__main__":

    Port = int(
        os.environ.get(
            "PORT",
            5000,
        )
    )

    
    if not os.environ.get("RENDER"):
        Url = (
            f"http://127.0.0.1:{Port}"
        )

        threading.Timer(
            1.5,
            lambda: webbrowser.open(Url),
        ).start()

    Application.run(
        host="0.0.0.0",
        port=Port,
        debug=False,
    )