from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase


class LeaveChoicesEndpointTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username='leave_choice_tester',
            email='leave_choice_tester@example.com',
            password='pass1234',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_leave_choices_exposes_all_backend_values(self):
        response = self.client.get(reverse('leave-requests-choices'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        values = {item['value'] for item in response.data}
        self.assertIn('ANNUAL', values)
        self.assertIn('SICK', values)
        self.assertIn('CASUAL', values)
        self.assertIn('UNPAID', values)
        self.assertIn('MATERNITY', values)
        self.assertIn('PATERNITY', values)
        self.assertIn('COMPASSIONATE', values)
        self.assertIn('STUDY', values)
        self.assertIn('BEREAVEMENT', values)
