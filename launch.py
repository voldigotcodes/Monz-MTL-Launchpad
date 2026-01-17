import requests

ACCESS_TOKEN = "REDACTED_META_TOKEN"
AD_ACCOUNT_ID = "act_5447989218625588"

url = f"https://graph.facebook.com/v18.0/{AD_ACCOUNT_ID}/campaigns"
params = {
    "access_token": ACCESS_TOKEN,
    "fields": "id,name,status"
}

r = requests.get(url, params=params)
print(r.json())