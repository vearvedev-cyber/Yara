from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PayrollComponentViewSet,
    PayrollEntryViewSet,
    SalaryRangeViewSet,
    TitleBreakdownViewSet,
    PayrollPeriodViewSet,
    PayslipViewSet,
    PAYEReturnViewSet,
    WorkspaceStatutorySettingsViewSet,
    PayeTaxBandViewSet,
    ComplianceDocumentViewSet,
)
from .gratuity_views import GratuityViewSet
from .settlement_views import FinalSettlementViewSet, PriorRedundancyPaymentViewSet

app_name = 'payroll'

router = DefaultRouter()
router.register(r'components', PayrollComponentViewSet, basename='component')
router.register(r'entries', PayrollEntryViewSet, basename='entry')
router.register(r'salary-ranges', SalaryRangeViewSet, basename='salary-range')
router.register(r'title-breakdowns', TitleBreakdownViewSet, basename='title-breakdown')
router.register(r'periods', PayrollPeriodViewSet, basename='period')
router.register(r'payslips', PayslipViewSet, basename='payslip')
router.register(r'paye-returns', PAYEReturnViewSet, basename='paye-return')
router.register(r'statutory-settings', WorkspaceStatutorySettingsViewSet, basename='statutory-settings')
router.register(r'paye-tax-bands', PayeTaxBandViewSet, basename='paye-tax-band')
router.register(r'compliance-documents', ComplianceDocumentViewSet, basename='compliance-document')
router.register(r'gratuity', GratuityViewSet, basename='gratuity')
router.register(r'settlements', FinalSettlementViewSet, basename='settlement')
router.register(r'prior-redundancy', PriorRedundancyPaymentViewSet, basename='prior-redundancy')

urlpatterns = [
    path('', include(router.urls)),
]
