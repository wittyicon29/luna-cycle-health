def test_resend_only_issues_token_for_unverified(client, db, make_user, outbox):
    verified = make_user(email="a@gmail.com", verified=True)
    unverified = make_user(email="b@gmail.com", verified=False)

    client.post("/api/v1/verify/resend", json={"email": "a@gmail.com"})
    client.post("/api/v1/verify/resend", json={"email": "b@gmail.com"})

    db.expire_all()
    db.refresh(verified)
    db.refresh(unverified)
    assert verified.email_verification_token is None
    assert unverified.email_verification_token
