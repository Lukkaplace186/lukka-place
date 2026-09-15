import { NextResponse } from 'next/server';
import { getCurrentCustomerId, getCustomerById } from '@/lib/customers';
import { customerUnauthorized } from '@/lib/customerApiResponse';
import { splitPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/**
 * The signed-in customer's own name and number, for prefilling public forms
 * (EnquiryCard's "Demander une visite").
 *
 * Why the prefill matters and is not cosmetic: a customer's requests are
 * found in their account BY PHONE (lib/customerInquiries.js scopes the
 * engine's leads to `customers.phone`). A signed-in visitor who typed their
 * number in another format — or a different number — created a visit request
 * their own account never showed.
 *
 * Fetched by the browser rather than read while rendering the listing page,
 * so a listing view costs no customer read for anyone who never opens the
 * form. The number is split server-side so the client needs no phone logic.
 * `private, no-store`: this is one person's data.
 */
export async function GET() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const customer = await getCustomerById(customerId);
  if (!customer) return customerUnauthorized();

  const { country, national } = splitPhone(customer.phone);
  return NextResponse.json(
    { fullName: customer.full_name || '', phoneCountry: country, phoneNational: national },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
