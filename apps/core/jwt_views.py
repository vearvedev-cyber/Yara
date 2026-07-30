from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework import serializers
from rest_framework.throttling import AnonRateThrottle
from apps.core.models import WorkspaceMembership


class AuthRateThrottle(AnonRateThrottle):
    """Stricter throttle for login attempts — 10 per minute per IP."""
    scope = 'auth'


class WorkspaceAwareTokenObtainPairSerializer(TokenObtainPairSerializer):
    workspace_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        # Extract optional workspace_id from request data
        workspace_id = attrs.pop('workspace_id', None)
        data = super().validate(attrs)

        user = self.user
        
        # Fetch all active workspace memberships in a SINGLE query with select_related
        memberships = WorkspaceMembership.objects.filter(
            user=user,
            is_active=True
        ).select_related('workspace').prefetch_related('workspace')

        # Superuser with no memberships: auto-join all active workspaces so login works
        if not memberships.exists() and user.is_superuser:
            from apps.core.models import Workspace
            for i, ws in enumerate(Workspace.objects.filter(is_active=True)):
                WorkspaceMembership.objects.get_or_create(
                    user=user,
                    workspace=ws,
                    defaults={'role': 'OWNER', 'is_default': i == 0, 'is_active': True},
                )
            memberships = WorkspaceMembership.objects.filter(
                user=user,
                is_active=True,
            ).select_related('workspace')
        
        # Build comprehensive workspace data for frontend (avoid second API call)
        workspace_list = []
        default_ws = None
        workspace_ids = []
        
        request = self.context.get('request')

        for m in memberships:
            workspace_ids.append(m.workspace_id)

            logo_url = None
            if request and (m.workspace.logo or m.workspace.logo_data):
                logo_url = request.build_absolute_uri(f'/api/v1/core/workspaces/{m.workspace.pk}/logo/')

            workspace_data = {
                'id': m.workspace_id,
                'name': m.workspace.name,
                'code': m.workspace.code,
                'workspace_type': m.workspace.workspace_type,
                'is_default': m.is_default,
                'role': m.role,
                'logo': logo_url,
            }
            workspace_list.append(workspace_data)
            
            if m.is_default:
                default_ws = m.workspace_id
        
        # If no default, use first
        if not default_ws and workspace_ids:
            default_ws = workspace_ids[0]
        
        # Respect requested workspace if user has access
        selected_ws = workspace_id if (workspace_id and workspace_id in workspace_ids) else default_ws
        
        # Include comprehensive workspace data to AVOID second API call
        data['workspaces'] = workspace_list  # Array of full workspace objects
        data['workspace_ids'] = workspace_ids
        data['default_workspace_id'] = default_ws
        data['selected_workspace_id'] = selected_ws
        
        return data


class WorkspaceAwareTokenObtainPairView(TokenObtainPairView):
    serializer_class = WorkspaceAwareTokenObtainPairSerializer
    throttle_classes = [AuthRateThrottle]
