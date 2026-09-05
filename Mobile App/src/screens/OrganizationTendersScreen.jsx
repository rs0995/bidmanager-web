import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { TenderList } from '../components/tender/TenderList.jsx';
import { useTenders } from '../hooks/useTenders.js';

export function OrganizationTendersScreen() {
  const { name } = useParams();
  const [searchParams] = useSearchParams();
  const orgName = decodeURIComponent(name);
  const websiteId = searchParams.get('website_id') || undefined;

  const query = useTenders({ organization: orgName, website_id: websiteId });

  return (
    <div>
      <ScreenHeader title={orgName} back />
      <TenderList query={query} />
    </div>
  );
}
