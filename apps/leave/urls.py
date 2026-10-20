from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LeaveRequestViewSet, SickNoteViewSet, AbsenteeismViewSet, DoubleTicketRequestViewSet,
    LeaveBalanceViewSet, LeavePolicyViewSet,
)

router = DefaultRouter()
router.register(r'requests', LeaveRequestViewSet, basename='leave-requests')
router.register(r'sick-notes', SickNoteViewSet, basename='sick-notes')
router.register(r'absenteeism', AbsenteeismViewSet, basename='absenteeism')
router.register(r'double-tickets', DoubleTicketRequestViewSet, basename='double-tickets')
router.register(r'balances', LeaveBalanceViewSet, basename='leave-balances')
router.register(r'policies', LeavePolicyViewSet, basename='leave-policies')

urlpatterns = [
	path('', include(router.urls)),
]
