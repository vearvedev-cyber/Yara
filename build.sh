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

echo "Creating superuser and workspace if configured..."
python manage.py shell -c "
from django.contrib.auth import get_user_model
from apps.core.models import Workspace, WorkspaceMembership
import os
User = get_user_model()

email = os.environ.get('SUPERUSER_EMAIL')
password = os.environ.get('SUPERUSER_PASSWORD')
ws_name = os.environ.get('WORKSPACE_NAME', 'Default')
ws_code = os.environ.get('WORKSPACE_CODE', 'DEFAULT')

# Create superuser
user = None
if email and password:
    if not User.objects.filter(email=email).exists():
        user = User.objects.create_superuser(username=email, email=email, password=password)
        print(f'Superuser {email} created.')
    else:
        user = User.objects.get(email=email)
        print(f'Superuser {email} already exists.')

# Create default workspace
if user:
    ws, ws_created = Workspace.objects.get_or_create(
        code=ws_code,
        defaults={'name': ws_name, 'workspace_type': 'COMPANY', 'is_active': True, 'created_by': user}
    )
    if ws_created:
        print(f'Workspace {ws_name} created.')
    else:
        print(f'Workspace {ws_name} already exists.')

    # Create membership
    mem, mem_created = WorkspaceMembership.objects.get_or_create(
        user=user,
        workspace=ws,
        defaults={'role': 'OWNER', 'is_default': True, 'is_active': True}
    )
    if mem_created:
        print(f'Membership created: {email} -> {ws_name} (OWNER, default).')
    else:
        print(f'Membership already exists.')
else:
    print('Skipping workspace setup — SUPERUSER_EMAIL/PASSWORD not set.')
"

echo "Build complete!"
