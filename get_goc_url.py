import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://commons.wikimedia.org/w/api.php?action=query&titles=File:G%C3%B6%C3%A7%20%C4%B0daresi%20Genel%20M%C3%BCd%C3%BCrl%C3%BC%C4%9F%C3%BC%20logosu.png&prop=imageinfo&iiprop=url&format=json"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
response = urllib.request.urlopen(req, context=ctx)
data = json.loads(response.read())

pages = data['query']['pages']
for page_id in pages:
    print(pages[page_id]['imageinfo'][0]['url'])
