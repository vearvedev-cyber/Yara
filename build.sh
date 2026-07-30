#!/usr/bin/env bash
# Build script for Render deployment

set -o errexit

echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo "Collecting static files..."
python manage.py collectstatic --no-input

echo "Running database migrations..."
python manage.py migrate --no-input

echo "Creating superuser if configured..."
python manage.py shell -c "
from django.contrib.auth import get_user_model
import os
User = get_user_model()
email = os.environ.get('SUPERUSER_EMAIL')
password = os.environ.get('SUPERUSER_PASSWORD')
if email and password and not User.objects.filter(email=email).exists():
    User.objects.create_superuser(username=email, email=email, password=password)
    print(f'Superuser {email} created.')
else:
    print('Superuser already exists or env vars not set.')
"

echo "Build complete!"
