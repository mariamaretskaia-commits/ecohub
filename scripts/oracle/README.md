# EcoHub на Oracle Cloud Always Free (0 ₽)

Постоянный сервер в облаке Oracle. Карта для проверки аккаунта может понадобиться – **тариф Always Free списаний не делает**, если не включать платные сервисы.

## 1. Аккаунт Oracle

1. Откройте https://cloud.oracle.com  
2. Зарегистрируйтесь (Always Free).  
3. Дождитесь создания **tenancy** (письмо на почту, иногда 10–30 минут).

## 2. Виртуальная машина

В консоли Oracle Cloud:

1. **Compute → Instances → Create instance**
2. Имя: `ecohub`
3. **Image:** Canonical Ubuntu 22.04 (или 24.04)
4. **Shape:** Always Free  
   - предпочтительно **VM.Standard.A1.Flex** (Ampere ARM): 1 OCPU, 6 GB RAM  
   - если нет квоты: **VM.Standard.E2.1.Micro** (AMD)
5. **Networking:** создайте VCN по умолчанию, **Assign a public IPv4 address**
6. **SSH keys:** Generate a key pair → скачайте **private key** (`.key`) и сохраните  
7. Create

Скопируйте **Public IP** инстанса.

## 3. Открыть порты 80 и 443

1. Instance → **Subnet** → **Security List** (Default Security List)  
2. **Add Ingress Rules:**

| Source | Protocol | Destination Port |
|--------|----------|------------------|
| 0.0.0.0/0 | TCP | 22 |
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

На самой VM (Ubuntu) также:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true
```

## 4. Подключение по SSH

На Windows (PowerShell), ключ с рабочего стола:

```powershell
ssh -i "$env:USERPROFILE\Downloads\ssh-key-….key" ubuntu@ВАШ_ПУБЛИЧНЫЙ_IP
```

Для образа Oracle Linux пользователь часто `opc`, для Ubuntu – `ubuntu`.

## 5. Упаковать и залить проект

На своём ПК в папке проекта:

```powershell
powershell -File scripts\oracle\pack.ps1
```

Появится `ecohub-oracle.zip` (на рабочем столе или в проекте).  
Залейте на сервер через **WinSCP** или:

```powershell
scp -i "$env:USERPROFILE\Downloads\ssh-key-….key" $env:USERPROFILE\Desktop\ecohub-oracle.zip ubuntu@ВАШ_IP:~/
```

На сервере:

```bash
sudo apt-get update && sudo apt-get install -y unzip
mkdir -p ~/ecohub && unzip -o ~/ecohub-oracle.zip -d ~/ecohub
chmod +x ~/ecohub/scripts/oracle/*.sh
```

Проверьте `~/ecohub/.env`:

```env
BOT_TOKEN=ваш_токен
JWT_SECRET=любая_длинная_строка
WEBAPP_URL=https://временный-потом-обновим.duckdns.org
NODE_ENV=production
PORT=3001
```

## 6. Установка приложения

```bash
bash ~/ecohub/scripts/oracle/install.sh
curl -s http://127.0.0.1:3001/health
```

Должно вернуть `{"ok":true,"service":"ecohub"}`.

## 7. Бесплатный HTTPS (DuckDNS + Caddy)

1. Зарегистрируйтесь на https://www.duckdns.org (через Google)  
2. Создайте поддомен, например `ecohub-grodno` → `ecohub-grodno.duckdns.org`  
3. Вставьте **ваш Public IP** Oracle и Save  
4. Скопируйте **token**

На сервере:

```bash
export DUCKDNS_DOMAIN=ecohub-grodno.duckdns.org
export DUCKDNS_TOKEN=ваш_токен_duckdns
bash ~/ecohub/scripts/oracle/setup-https.sh
```

Проверка:

```bash
curl -s https://ecohub-grodno.duckdns.org/health
```

## 8. Telegram

Скрипт `setup-https` сам вызовет `npm run bot:setup`.  
Если нет – вручную:

```bash
cd ~/ecohub && npm run bot:setup
```

В Telegram: **@EcoHubBY_bot** → `/start` → кнопка EcoHub.

## 9. Ноутбук можно выключать

Сервис `ecohub` и Caddy стартуют сами после перезагрузки VM.

Полезные команды:

```bash
sudo systemctl status ecohub
sudo journalctl -u ecohub -f
sudo systemctl restart ecohub
```

## Если Always Free Shape недоступен

В регионе может не хватать Ampere. Попробуйте:
- другой **Home Region** при регистрации (редко меняется),  
- shape **E2.1.Micro**,  
- подождать и создать инстанс позже.

## Важно про карту

Oracle часто просит карту при регистрации. На Always Free **не должно быть списаний**, если:
- не создавать платные инстансы,  
- не поднимать платный Object Storage сверх лимитов,  
- следить, что Capacity Type = Always Free Eligible.
